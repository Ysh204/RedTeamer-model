import React, { useEffect, useRef } from 'react'

const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
]

function mulberry(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PERM = new Uint8Array(512)
{
  const r = mulberry(0x9e3779b9)
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = (r() * (i + 1)) | 0
    const tmp = p[i]
    p[i] = p[j]
    p[j] = tmp
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]
}

function fade(t: number) {
  return t * t * (3 - 2 * t)
}

function rawNoise2d(x: number, y: number): number {
  const xi = Math.floor(x) & 255
  const yi = Math.floor(y) & 255
  const xf = x - Math.floor(x)
  const yf = y - Math.floor(y)
  const u = fade(xf)
  const v = fade(yf)
  const aa = PERM[PERM[xi] + yi]
  const ab = PERM[PERM[xi] + yi + 1]
  const ba = PERM[PERM[xi + 1] + yi]
  const bb = PERM[PERM[xi + 1] + yi + 1]
  const x1 = aa + u * (ba - aa)
  const x2 = ab + u * (bb - ab)
  return (x1 + v * (x2 - x1)) / 255
}

// Precompute fast tileable 256x256 lookup tables (<1ms) so inner loops never stall on page load
const LUT_DIM = 256
const LUT_MASK = 255
const NOISE_LUT = new Float32Array(LUT_DIM * LUT_DIM)
const FBM_LUT = new Float32Array(LUT_DIM * LUT_DIM)
{
  for (let y = 0; y < LUT_DIM; y++) {
    const row = y * LUT_DIM
    for (let x = 0; x < LUT_DIM; x++) {
      const nx = x * 0.25
      const ny = y * 0.25
      const n1 = rawNoise2d(nx, ny)
      const n2 = rawNoise2d(nx * 2 + 19.1, ny * 2 + 13.7)
      const n3 = rawNoise2d(nx * 4 + 37.9, ny * 4 + 53.3)
      NOISE_LUT[row + x] = n1
      FBM_LUT[row + x] = n1 * 0.52 + n2 * 0.31 + n3 * 0.17
    }
  }
}

function fastNoise(x: number, y: number): number {
  const ix = ((x * 4) | 0) & LUT_MASK
  const iy = ((y * 4) | 0) & LUT_MASK
  return NOISE_LUT[(iy << 8) | ix]
}

function fastFbm(x: number, y: number): number {
  const ix = ((x * 4) | 0) & LUT_MASK
  const iy = ((y * 4) | 0) & LUT_MASK
  return FBM_LUT[(iy << 8) | ix]
}

export function BurningDataCenterMachine() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const rand = mulberry(0x51f15e)

    let raf = 0
    let running = true
    let w = 0
    let h = 0
    let tick = 0

    let heat = new Float32Array(0)
    let next = new Float32Array(0)
    let ember = new Float32Array(0)
    let luma = new Float32Array(0)
    let rackMask = new Uint8Array(0)
    let burnZone = new Float32Array(0)
    let depthBuf = new Float32Array(0)
    let emitterList = new Int32Array(0)
    let emitterCount = 0
    let pixels: ImageData | null = null

    // Three-quarter downward perspective for the packed 3-Rack Data Center Cluster
    const DEFAULT_PITCH = 0.24
    const DEFAULT_YAW = -0.56
    let pitch = DEFAULT_PITCH
    let yaw = DEFAULT_YAW
    let targetPitch = DEFAULT_PITCH
    let targetYaw = DEFAULT_YAW
    let lastRasterPitch = -999
    let lastRasterYaw = -999
    let velPitch = 0
    let velYaw = 0
    let isDragging = false
    let lastMouseX = 0
    let lastMouseY = 0
    let mouseWindX = 0
    let surgeHeat = 0

    let plumeCx = 0
    let plumeCy = 0
    let scaleRadius = 60
    let plumeSpanX = 90

    // Pre-generate high-detail 3D Data Center Server Rack Textures (128x224):
    // 1. Front Door: brushed dark-steel frame, swing-handle latch with lock cylinder,
    //    upper EDGERACK header window, silver LCD telemetry touch display, and tall glass door
    //    densely packed from top to bottom with 1U/2U server blades, drive bays, LEDs, & bottom UPS units.
    // 2. Side Panel: split upper & lower removable panels with horizontal divider bar,
    //    4 recessed slam-latches, upper dark rectangular exhaust window with bright bezel, and diagonal metallic sheen.
    // 3. Top Roof Panel: dual exhaust fan grilles & cable entry slots.
    const TEX_W = 128
    const TEX_H = 224
    const frontTex = new Float32Array(TEX_W * TEX_H)
    const frontBurnTex = new Float32Array(TEX_W * TEX_H)
    const sideTex = new Float32Array(TEX_W * TEX_H)
    const sideBurnTex = new Float32Array(TEX_W * TEX_H)
    const topTex = new Float32Array(TEX_W * TEX_W)

    for (let ty = 0; ty < TEX_H; ty++) {
      const v = ty / (TEX_H - 1)
      for (let tx = 0; tx < TEX_W; tx++) {
        const u = tx / (TEX_W - 1)
        const idx = ty * TEX_W + tx

        let frame = 0.28 + (1 - u) * 0.12 + (1 - v) * 0.08
        if (u < 0.032 || v < 0.018) {
          frame = 0.92
        } else if (u > 0.962 || v > 0.982) {
          frame = 0.78
        } else if ((u > 0.048 && u < 0.068) || (u > 0.93 && u < 0.95)) {
          frame = 0.12
        }

        let val = frame
        let burn = 0.0

        // Left swing-handle latch (v in 0.43..0.53, u in 0.045..0.13)
        if (v >= 0.43 && v <= 0.53 && u >= 0.045 && u <= 0.13) {
          if (v >= 0.435 && v <= 0.525 && u >= 0.06 && u <= 0.115) {
            val = 0.06
            if (v >= 0.45 && v <= 0.5 && u >= 0.075 && u <= 0.098) {
              val = 0.72
            }
            if (Math.abs(v - 0.512) < 0.008 && Math.abs(u - 0.086) < 0.014) {
              val = 0.96
            }
          } else {
            val = 0.82
          }
        }

        const inWindowX = u >= 0.17 && u <= 0.83

        // A) Upper EDGERACK Header Window (v in 0.055..0.19)
        if (inWindowX && v >= 0.055 && v <= 0.19) {
          if (u < 0.19 || u > 0.81 || v < 0.065 || v > 0.18) {
            val = 0.78
          } else {
            const refl = Math.max(0, Math.sin((v - 0.09) * 26.0) * (1 - Math.abs(u - 0.45) * 1.4))
            val = 0.12 + refl * 0.55
            if (v >= 0.082 && v <= 0.108 && u >= 0.24 && u <= 0.76) {
              const charCell = Math.floor((u - 0.24) * 32)
              const rowCell = Math.floor((v - 0.082) * 160)
              if (charCell % 2 === 0 && (rowCell === 0 || rowCell === 2 || rowCell === 3)) {
                val = 0.96
              }
            }
            burn = 0.95
          }
        }
        // B) Recessed LCD Telemetry Control Touch Panel (v in 0.22..0.325)
        else if (v >= 0.22 && v <= 0.325 && u >= 0.22 && u <= 0.78) {
          if (u < 0.26 || u > 0.74 || v < 0.235 || v > 0.31) {
            val = 0.86
          } else {
            val = 0.14 + (0.65 - u) * 0.18
            if (v >= 0.255 && v <= 0.29 && u >= 0.34 && u <= 0.66) {
              if (((u * 48) | 0) % 3 === 0 && ((v * 90) | 0) % 2 === 0) {
                val = 0.94
              }
            }
            burn = 0.92
          }
        }
        // C) Tall Lower Tempered-Glass Server Bay Door — densely packed with 9 stacked server blades & UPS units right to the bottom
        else if (inWindowX && v >= 0.36 && v <= 0.93) {
          if (u < 0.19 || u > 0.81 || v < 0.37 || v > 0.92) {
            val = 0.84
          } else {
            if ((u >= 0.198 && u <= 0.255) || (u >= 0.745 && u <= 0.802)) {
              const railHole =
                ty % 3 === 0 && ((u >= 0.212 && u <= 0.238) || (u >= 0.762 && u <= 0.788))
              val = railHole ? 0.08 : 0.72
            } else {
              const bayV = (v - 0.37) / 0.55
              const slot = (bayV * 9.0) % 1.0
              const unitIdx = (bayV * 9.0) | 0

              if (slot < 0.16) {
                val = 0.92 - (u - 0.25) * 0.25
              } else if (slot < 0.76) {
                const isDriveBay = tx % 6 < 4
                const isLed = tx % 6 === 0 && ty % 2 === 0
                if (isLed) {
                  val = 0.96
                } else if (isDriveBay) {
                  val =
                    0.2 +
                    (0.75 - u) * 0.18 +
                    (unitIdx % 2 === 0 && ty % 2 === 0 ? 0.12 : 0.0)
                } else {
                  val = 0.42
                }
              } else {
                val = 0.08
              }

              const glassSheen =
                Math.max(0, 1 - Math.abs(u - 0.32 - (v - 0.65) * 0.45) * 3.2) * 0.26
              val = Math.min(0.96, val + glassSheen)
            }

            if (v < 0.64) {
              burn = Math.max(0.45, Math.min(1, (0.66 - v) * 2.4))
            }
          }
        }

        // Bottom heavy base kickplate / serial badge
        if (v >= 0.945 && v <= 0.982 && u >= 0.24 && u <= 0.76) {
          val = tx % 3 !== 0 && Math.abs(v - 0.963) < 0.008 ? 0.72 : 0.18
        }

        if (v < 0.36 && u > 0.12 && u < 0.88) {
          burn = Math.max(burn, Math.min(1, (0.38 - v) * 2.6))
        }

        frontTex[idx] = Math.max(0.05, Math.min(0.99, val))
        frontBurnTex[idx] = Math.min(1, burn)
      }
    }

    // Build Side Panel Texture (split upper/lower panels, 4 slam latches, upper dark vent window, studio sheen)
    for (let ty = 0; ty < TEX_H; ty++) {
      const v = ty / (TEX_H - 1)
      for (let tx = 0; tx < TEX_W; tx++) {
        const u = tx / (TEX_W - 1)
        const idx = ty * TEX_W + tx

        const sheen =
          Math.exp(-((u - 0.58) * (u - 0.58) * 2.6 + (v - 0.48) * (v - 0.48) * 2.8)) * 0.48
        let val = 0.34 + sheen

        if (u < 0.035 || u > 0.96 || v < 0.018 || v > 0.98) {
          val = u < 0.024 || v < 0.012 || v > 0.985 ? 0.84 : 0.14
        } else if (v >= 0.475 && v <= 0.512) {
          if (Math.abs(v - 0.475) < 0.006 || Math.abs(v - 0.512) < 0.006) {
            val = 0.12
          } else {
            val = 0.48 + sheen * 0.4
          }
        }

        if (Math.abs(v - 0.055) < 0.005 && u > 0.04 && u < 0.95) {
          val = 0.1
        }

        const inLatchV = (v >= 0.068 && v <= 0.112) || (v >= 0.525 && v <= 0.568)
        const inLatchU = (u >= 0.18 && u <= 0.235) || (u >= 0.76 && u <= 0.815)
        if (inLatchV && inLatchU) {
          val = tx % 2 === 0 && ty % 2 === 0 ? 0.85 : 0.1
        }

        let burn = 0.0
        if (v >= 0.085 && v <= 0.245 && u >= 0.42 && u <= 0.68) {
          if (u < 0.445 || u > 0.655 || v < 0.095 || v > 0.235) {
            val = 0.9
          } else {
            val = 0.07
            burn = 0.95
          }
        }

        if (v < 0.38 && u > 0.1 && u < 0.9) {
          burn = Math.max(burn, Math.min(1, (0.4 - v) * 2.8))
        }

        sideTex[idx] = Math.max(0.05, Math.min(0.99, val))
        sideBurnTex[idx] = Math.min(1, burn)
      }
    }

    // Build Top Roof Exhaust Panel Texture
    for (let ty = 0; ty < TEX_W; ty++) {
      const v = ty / (TEX_W - 1)
      for (let tx = 0; tx < TEX_W; tx++) {
        const u = tx / (TEX_W - 1)
        const idx = ty * TEX_W + tx
        const maxC = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2
        if (maxC > 0.92) {
          topTex[idx] = 0.88
        } else if (maxC > 0.84) {
          topTex[idx] = 0.24
        } else {
          const d1 = Math.hypot(u - 0.5, v - 0.33)
          const d2 = Math.hypot(u - 0.5, v - 0.67)
          if (d1 < 0.24 || d2 < 0.24) {
            topTex[idx] = (tx + ty) % 3 === 0 ? 0.75 : 0.12
          } else {
            topTex[idx] = 0.42
          }
        }
      }
    }

    const fit = () => {
      const parent = canvas.parentElement
      const cssW = Math.max(1, parent?.clientWidth || window.innerWidth || 560)
      const rawH = parent?.clientHeight || 0
      const cssH = Math.max(1, rawH > 200 ? rawH : window.innerHeight || 540)

      const targetH = Math.min(420, Math.max(300, Math.round(cssH * 0.68)))
      const scale = targetH / cssH
      const nextW = Math.max(240, Math.round(cssW * scale))
      const nextH = Math.max(260, Math.round(cssH * scale))
      if (nextW === w && nextH === h && pixels) return false

      w = nextW
      h = nextH
      canvas.width = w
      canvas.height = h

      const size = w * h
      heat = new Float32Array(size)
      next = new Float32Array(size)
      ember = new Float32Array(size)
      luma = new Float32Array(size)
      rackMask = new Uint8Array(size)
      burnZone = new Float32Array(size)
      depthBuf = new Float32Array(size)
      emitterList = new Int32Array(size)
      pixels = ctx.createImageData(w, h)
      lastRasterPitch = -999
      lastRasterYaw = -999
      return true
    }

    // Rasterize all 3 tightly-packed Data Center Server Rack Cabinets with solid base plinths
    const rasterize3DRackCluster = () => {
      if (
        Math.abs(pitch - lastRasterPitch) < 0.0008 &&
        Math.abs(yaw - lastRasterYaw) < 0.0008
      ) {
        return
      }
      lastRasterPitch = pitch
      lastRasterYaw = yaw

      luma.fill(0)
      rackMask.fill(0)
      burnZone.fill(0)
      depthBuf.fill(-1e9)

      const aspect = w / Math.max(1, h)
      const screenCx = aspect > 1.38 ? w * 0.64 : w * 0.52
      const screenCy = h * 0.68
      const scaleR = Math.min(w * 0.215, h * 0.21)
      scaleRadius = scaleR

      const cosY = Math.cos(yaw)
      const sinY = Math.sin(yaw)
      const cosP = Math.cos(pitch)
      const sinP = Math.sin(pitch)

      // True downward-looking camera projection:
      // Foreground points (ry < 0) project lower on screen (-ry * sinP) and have larger camera depth (+lz * sinP - ry * cosP)
      // so the rear wall never pokes out below the front door!
      const project = (lx: number, ly: number, lz: number) => {
        const rx = lx * cosY - ly * sinY
        const ry = lx * sinY + ly * cosY
        const syLocal = -lz * cosP - ry * sinP
        const szDepth = lz * sinP - ry * cosP
        const persp = 1 / (1 - szDepth * 0.04)
        return {
          sx: screenCx + rx * scaleR * persp,
          sy: screenCy + syLocal * scaleR * persp,
          sz: szDepth,
        }
      }

      const drawQuad = (
        p00: { sx: number; sy: number; sz: number },
        p10: { sx: number; sy: number; sz: number },
        p11: { sx: number; sy: number; sz: number },
        p01: { sx: number; sy: number; sz: number },
        shadeFn: (u: number, v: number) => { l: number; burn: number; mask: number } | null
      ) => {
        const rasterTri = (
          a: { sx: number; sy: number; sz: number },
          au: number,
          av: number,
          b: { sx: number; sy: number; sz: number },
          bu: number,
          bv: number,
          c: { sx: number; sy: number; sz: number },
          cu: number,
          cv: number
        ) => {
          const denom = (b.sy - c.sy) * (a.sx - c.sx) + (c.sx - b.sx) * (a.sy - c.sy)
          if (Math.abs(denom) < 0.0001) return
          const invDenom = 1 / denom
          const tMinX = Math.max(0, Math.floor(Math.min(a.sx, b.sx, c.sx)))
          const tMaxX = Math.min(w - 1, Math.ceil(Math.max(a.sx, b.sx, c.sx)))
          const tMinY = Math.max(0, Math.floor(Math.min(a.sy, b.sy, c.sy)))
          const tMaxY = Math.min(h - 1, Math.ceil(Math.max(a.sy, b.sy, c.sy)))

          for (let py = tMinY; py <= tMaxY; py++) {
            const row = py * w
            for (let px = tMinX; px <= tMaxX; px++) {
              const w0 = ((b.sy - c.sy) * (px - c.sx) + (c.sx - b.sx) * (py - c.sy)) * invDenom
              const w1 = ((c.sy - a.sy) * (px - c.sx) + (a.sx - c.sx) * (py - c.sy)) * invDenom
              const w2 = 1 - w0 - w1
              if (w0 < -0.002 || w1 < -0.002 || w2 < -0.002) continue

              const z = w0 * a.sz + w1 * b.sz + w2 * c.sz
              const idx = row + px
              if (z >= depthBuf[idx]) {
                const u = Math.max(0, Math.min(1, w0 * au + w1 * bu + w2 * cu))
                const v = Math.max(0, Math.min(1, w0 * av + w1 * bv + w2 * cv))
                const res = shadeFn(u, v)
                if (!res) continue
                depthBuf[idx] = z
                luma[idx] = res.l
                burnZone[idx] = res.burn
                rackMask[idx] = res.mask
              }
            }
          }
        }

        rasterTri(p00, 0, 0, p10, 1, 0, p11, 1, 1)
        rasterTri(p00, 0, 0, p11, 1, 1, p01, 0, 1)
      }

      const W = 0.36
      const D = 0.54
      const H = 1.02
      const GAP = 0.03

      // 3 tightly-packed Data Center Server Rack Cabinets
      const rackConfigs = [
        { ox: -(2 * W + GAP), oy: 0.0, hScale: 0.98, bMult: 0.92 },
        { ox: 0.0, oy: 0.0, hScale: 1.02, bMult: 1.02 },
        { ox: 2 * W + GAP, oy: 0.0, hScale: 0.98, bMult: 0.96 },
      ]

      for (let r = 0; r < rackConfigs.length; r++) {
        const { ox, oy, hScale, bMult } = rackConfigs[r]
        const rH = H * hScale
        const baseZ = -H
        const topZ = baseZ + 2.0 * rH
        const plinthZ = baseZ - 0.09

        // Solid Heavy Base Plinth / Pedestal Skirt sealing the entire underside of each cabinet
        const pw = W * 0.98
        const pd = D * 0.98
        const ptfl = project(ox - pw, oy - pd, baseZ)
        const ptfr = project(ox + pw, oy - pd, baseZ)
        const ptbr = project(ox + pw, oy + pd, baseZ)
        const ptbl = project(ox - pw, oy + pd, baseZ)

        const pbfl = project(ox - pw, oy - pd, plinthZ)
        const pbfr = project(ox + pw, oy - pd, plinthZ)
        const pbbr = project(ox + pw, oy + pd, plinthZ)
        const pbbl = project(ox - pw, oy + pd, plinthZ)

        const plinthShader = (lt: number) => (u: number, v: number) => ({
          l:
            (v > 0.72 && (u < 0.14 || u > 0.86)
              ? 0.82
              : v < 0.22
                ? 0.55
                : 0.18) * lt,
          burn: 0.0,
          mask: 1,
        })
        drawQuad(ptfl, ptfr, pbfr, pbfl, plinthShader(0.9))
        drawQuad(ptfr, ptbr, pbbr, pbfr, plinthShader(0.75))
        drawQuad(ptbr, ptbl, pbbl, pbbr, plinthShader(0.6))
        drawQuad(ptbl, ptfl, pbfl, pbbl, plinthShader(0.7))
        drawQuad(pbfl, pbfr, pbbr, pbbl, () => ({ l: 0.16, burn: 0.0, mask: 1 }))

        const ftl = project(ox - W, oy - D, topZ)
        const ftr = project(ox + W, oy - D, topZ)
        const fbr = project(ox + W, oy - D, baseZ)
        const fbl = project(ox - W, oy - D, baseZ)

        const btl = project(ox - W, oy + D, topZ)
        const btr = project(ox + W, oy + D, topZ)
        const bbr = project(ox + W, oy + D, baseZ)
        const bbl = project(ox - W, oy + D, baseZ)

        // Solid bottom floor plate of cabinet
        drawQuad(fbl, fbr, bbr, bbl, () => ({ l: 0.2, burn: 0.0, mask: 1 }))

        const frontShader = (u: number, v: number) => {
          const tx = Math.min(TEX_W - 1, (u * TEX_W) | 0)
          const ty = Math.min(TEX_H - 1, (v * TEX_H) | 0)
          const idx = ty * TEX_W + tx
          return {
            l: Math.min(0.99, frontTex[idx] * bMult),
            burn: frontBurnTex[idx],
            mask: v < 0.45 ? 2 : 1,
          }
        }

        const rearShader = (u: number, v: number) => {
          const tx = Math.min(TEX_W - 1, ((1 - u) * TEX_W) | 0)
          const ty = Math.min(TEX_H - 1, (v * TEX_H) | 0)
          const idx = ty * TEX_W + tx
          return {
            l: Math.min(0.99, frontTex[idx] * 0.82 * bMult),
            burn: frontBurnTex[idx],
            mask: v < 0.45 ? 2 : 1,
          }
        }

        const sideShaderR = (u: number, v: number) => {
          const tx = Math.min(TEX_W - 1, (u * TEX_W) | 0)
          const ty = Math.min(TEX_H - 1, (v * TEX_H) | 0)
          const idx = ty * TEX_W + tx
          return {
            l: Math.min(0.99, sideTex[idx] * bMult),
            burn: sideBurnTex[idx],
            mask: v < 0.35 ? 2 : 1,
          }
        }

        const sideShaderL = (u: number, v: number) => {
          const tx = Math.min(TEX_W - 1, ((1 - u) * TEX_W) | 0)
          const ty = Math.min(TEX_H - 1, (v * TEX_H) | 0)
          const idx = ty * TEX_W + tx
          return {
            l: Math.min(0.99, sideTex[idx] * 0.8 * bMult),
            burn: sideBurnTex[idx],
            mask: v < 0.35 ? 2 : 1,
          }
        }

        const topShader = (u: number, v: number) => {
          const tx = Math.min(TEX_W - 1, (u * TEX_W) | 0)
          const ty = Math.min(TEX_W - 1, (v * TEX_W) | 0)
          const dc = Math.hypot(u - 0.5, v - 0.5)
          return {
            l: Math.min(0.99, topTex[ty * TEX_W + tx] * bMult),
            burn: dc < 0.65 ? 1.0 : 0.8,
            mask: 3,
          }
        }

        drawQuad(ftl, ftr, fbr, fbl, frontShader)
        drawQuad(btr, btl, bbl, bbr, rearShader)
        drawQuad(ftr, btr, bbr, fbr, sideShaderR)
        drawQuad(btl, ftl, fbl, bbl, sideShaderL)
        drawQuad(btl, btr, ftr, ftl, topShader)
      }

      const roofCenter = project(0, 0, H * 0.72)
      plumeCx = roofCenter.sx
      plumeCy = roofCenter.sy
      plumeSpanX = scaleR * 1.85

      emitterCount = 0
      for (let y = 1; y < h - 1; y++) {
        const row = y * w
        for (let x = 1; x < w - 1; x++) {
          const i = row + x
          if (burnZone[i] > 0.22) {
            emitterList[emitterCount++] = i
          }
        }
      }
    }

    const seedFire = () => {
      const totalInt = Math.min(1.9, 1.22 + surgeHeat)
      const t = tick * 0.048

      for (let k = 0; k < emitterCount; k++) {
        const i = emitterList[k]
        const bz = burnZone[i]
        const x = i % w
        const y = (i / w) | 0
        const m = rackMask[i]
        const isUpperEdge =
          m >= 2 &&
          (rackMask[i - 1] !== m ||
            rackMask[i + 1] !== m ||
            rackMask[i - w] !== m ||
            rackMask[i + w] !== m)

        const n1 = fastFbm(x * 0.045 + t * 0.75, y * 0.045 - t * 1.6)
        const n2 = fastNoise(x * 0.11 - t * 1.2, y * 0.11 - t * 2.3)

        if (isUpperEdge && bz > 0.25) {
          const v = (220 + n1 * 50 + rand() * 28) * bz * totalInt
          if (v > heat[i]) heat[i] = v > 255 ? 255 : v
        } else if (bz > 0.35) {
          const fissure = n1 * 0.62 + n2 * 0.38
          if (fissure > 0.22) {
            const v = (195 + (fissure - 0.22) * 165 + rand() * 30) * bz * totalInt
            if (v > heat[i]) heat[i] = v > 255 ? 255 : v
          }
        }
      }
    }

    const stepHeat = () => {
      tick++
      const t = tick * 0.036
      const decayScale = 1 / Math.max(0.55, Math.min(1.75, 1.22 + surgeHeat * 0.65))

      for (let y = 0; y < h - 3; y++) {
        const row = y * w
        const heightFrac = Math.max(0, (plumeCy - y) / Math.max(1, plumeCy))
        const chimneyWave = Math.sin(heightFrac * 4.8 - t * 2.1) * (5.5 * heightFrac)
        const maxSpanInv = 1 / Math.max(1, plumeSpanX * (1.06 - heightFrac * 0.18))

        for (let x = 2; x < w - 2; x++) {
          const i = row + x
          const swirl = (fastFbm(x * 0.032 + t * 0.65, y * 0.028 + t * 1.8) - 0.5) * 4.8
          const centerPull = (x - (plumeCx + chimneyWave)) * 0.014 * heightFrac
          const jitter = (rand() - 0.5) * 1.8

          let srcX = Math.round(x + swirl + centerPull + jitter - mouseWindX * 1.8)
          if (srcX < 1) srcX = 1
          else if (srcX >= w - 1) srcX = w - 2

          const rLift = rand()
          const lift = rLift < 0.34 ? 3 : rLift < 0.8 ? 2 : 1
          const srcY = Math.min(h - 1, y + lift)
          const srcIdx = srcY * w + srcX

          const rawHeat =
            heat[srcIdx] * 0.68 +
            heat[srcY * w + (srcX - 1)] * 0.16 +
            heat[srcY * w + (srcX + 1)] * 0.16

          const coolNoise = fastNoise(x * 0.055 - t * 0.75, y * 0.048 + t * 2.0)
          const edgeDx = Math.abs(x - (plumeCx + chimneyWave)) * maxSpanInv
          const sideCooling = edgeDx > 0.85 ? (edgeDx - 0.85) * 4.0 : 0
          const baseDecay =
            (0.38 + coolNoise * 1.05 + sideCooling + (rand() < 0.22 ? 0.55 : 0.08)) * decayScale

          const nextVal = rawHeat - baseDecay
          next[i] = nextVal > 0 ? nextVal : 0

          const prevEmber = ember[srcIdx] * 0.96
          if (rawHeat > 60 && rawHeat < 165 && rand() < 0.012) {
            ember[i] = 240
          } else {
            ember[i] = prevEmber > 10 ? prevEmber : 0
          }
        }
      }

      next.fill(0, (h - 3) * w)
      heat.set(next)
      seedFire()

      mouseWindX *= 0.91
      surgeHeat *= 0.95
    }

    const paint = () => {
      if (!pixels) return
      const dst = pixels.data
      const t = tick * 0.042
      const invTopSpan = 1 / Math.max(1, scaleRadius * 0.5)

      for (let y = 0; y < h; y++) {
        const row = y * w
        const topHeightFactor = Math.max(
          0,
          Math.min(1, (plumeCy + scaleRadius * 0.22 - y) * invTopSpan)
        )

        for (let x = 0; x < w; x++) {
          const i = row + x
          const p = i * 4
          const rawCell = heat[i] / 255
          const spark = ember[i] / 255
          const maskVal = rackMask[i]
          const isRack = maskVal > 0
          const base = luma[i]

          if (!isRack && rawCell < 0.035 && spark < 0.08) {
            dst[p] = 5
            dst[p + 1] = 5
            dst[p + 2] = 5
            dst[p + 3] = 255
            continue
          }

          const billowLarge = fastFbm(x * 0.026 + t * 0.25, y * 0.022 + t * 1.35)
          const billowMed = fastFbm(x * 0.064 - t * 0.48, y * 0.056 + t * 2.15)
          const billowFine = fastNoise(x * 0.15 + t * 0.85, y * 0.14 + t * 2.9)
          const smokeField = billowLarge * 0.5 + billowMed * 0.34 + billowFine * 0.16

          const flame = Math.min(1, Math.max(0, (rawCell - 0.035) / 0.88))
          const voidPocket = Math.max(0, (smokeField - 0.36) * 2.75)
          const ridgeGlow = voidPocket > 0.03 && voidPocket < 0.34 ? 0.28 * flame : 0
          const carved = flame * Math.max(0.05, 1 - voidPocket * 0.94) + ridgeGlow
          const contourWave = Math.sin(x * 0.28 + billowLarge * 12.0 + y * 0.14) * 0.09 * flame
          const plumeG = Math.max(
            0,
            Math.min(1, Math.pow(Math.max(0, carved), 0.86) + contourWave + spark * 0.9)
          )

          let g = 0
          if (isRack) {
            const bz = burnZone[i]
            const melt = Math.max(0, Math.min(1, (rawCell - 0.22) / 0.78)) * Math.pow(bz, 1.3)
            let rackG = base

            if (melt > 0.15 && base < 0.9) {
              const charMask = Math.max(0, (smokeField - 0.42) * 2.5)
              if (charMask > 0.48) {
                rackG = base * 0.25 + (1 - Math.min(1, charMask)) * 0.22
              } else {
                const ridge = Math.max(0, Math.min(1, 1 - charMask * 1.35))
                rackG = base * (1 - melt * 0.65) + melt * ridge * 1.05
              }
            }

            const maskWeight = maskVal >= 2 ? 1.0 : 0.25
            const topBlend = topHeightFactor * Math.min(1, rawCell * 1.45) * maskWeight
            const blended = rackG * (1 - topBlend * 0.85) + plumeG * (topBlend * 0.85)
            g = Math.max(rackG * (1 - topBlend * 0.4), blended)
          } else {
            g = plumeG
          }

          const bayer = (BAYER8[y & 7][x & 7] + 0.5) / 64
          const hashNoise = (((x * 73856093) ^ (y * 19349663)) & 255) / 255
          const thresh = bayer * 0.62 + hashNoise * 0.38

          const q = g > thresh ? 242 : 5
          dst[p] = q
          dst[p + 1] = q
          dst[p + 2] = q
          dst[p + 3] = 255
        }
      }

      ctx.putImageData(pixels, 0, 0)
    }

    // Instant <5ms analytical plume ignition on mount across all 3 server racks
    const igniteInstant = () => {
      rasterize3DRackCluster()
      heat.fill(0)
      const maxY = Math.min(h - 4, Math.floor(plumeCy + scaleRadius * 0.48))
      for (let y = 0; y < maxY; y++) {
        const row = y * w
        const heightFrac = Math.max(0, (plumeCy - y) / Math.max(1, plumeCy))
        const wave = Math.sin(heightFrac * 4.5) * (5.5 * heightFrac)
        const halfSpan = plumeSpanX * (0.8 - heightFrac * 0.22)
        const minX = Math.max(2, Math.floor(plumeCx + wave - halfSpan))
        const maxX = Math.min(w - 3, Math.ceil(plumeCx + wave + halfSpan))
        for (let x = minX; x <= maxX; x++) {
          const dx = Math.abs(x - (plumeCx + wave)) / Math.max(1, halfSpan)
          const n = fastFbm(x * 0.04, y * 0.035)
          const envelope = Math.max(0, 1 - dx * dx) * (1 - heightFrac * 0.52)
          const val = envelope * 215 + (n - 0.35) * 120
          if (val > 10) heat[row + x] = Math.min(255, val)
        }
      }
      seedFire()
      for (let i = 0; i < 8; i++) stepHeat()
      paint()
    }

    const frame = () => {
      if (!running) return
      if (!isDragging) {
        const idleBreathP = Math.sin(tick * 0.018) * 0.018
        const idleBreathY = Math.cos(tick * 0.014) * 0.035
        velYaw *= 0.88
        velPitch *= 0.88
        yaw += velYaw + (targetYaw + idleBreathY - yaw) * 0.1
        pitch += velPitch + (targetPitch + idleBreathP - pitch) * 0.1
      }
      pitch = Math.max(0.08, Math.min(0.62, pitch))

      rasterize3DRackCluster()
      stepHeat()
      stepHeat()
      paint()
      if (!reduce) raf = requestAnimationFrame(frame)
    }

    const isPointNearCanvas = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      return (
        clientX >= rect.left - 40 &&
        clientX <= rect.right + 20 &&
        clientY >= rect.top - 20 &&
        clientY <= rect.bottom + 20
      )
    }

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
      if (!isPointNearCanvas(clientX, clientY)) return

      isDragging = true
      lastMouseX = clientX
      lastMouseY = clientY
      surgeHeat = Math.min(0.75, surgeHeat + 0.4)
    }

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
      const rect = canvas.getBoundingClientRect()

      if (isDragging) {
        const dx = clientX - lastMouseX
        const dy = clientY - lastMouseY
        lastMouseX = clientX
        lastMouseY = clientY

        velYaw = dx * 0.012
        velPitch = dy * 0.008
        yaw += velYaw
        pitch = Math.max(0.08, Math.min(0.62, pitch + velPitch))
        targetYaw = yaw
        targetPitch = pitch
        mouseWindX = Math.max(-2.8, Math.min(2.8, dx * 0.15))
      } else if (isPointNearCanvas(clientX, clientY)) {
        const nx = ((clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2
        const ny = ((clientY - rect.top) / Math.max(1, rect.height) - 0.6) * 2
        const dx = clientX - lastMouseX
        lastMouseX = clientX
        lastMouseY = clientY
        if (Math.abs(dx) < 80) {
          mouseWindX = Math.max(-2.0, Math.min(2.0, mouseWindX * 0.72 + dx * 0.065))
        }
        targetYaw = DEFAULT_YAW + nx * 0.35
        targetPitch = Math.max(0.12, Math.min(0.54, DEFAULT_PITCH + ny * 0.15))
      }
    }

    const handlePointerUp = () => {
      isDragging = false
    }

    const handleDoubleClick = (e: MouseEvent) => {
      if (!isPointNearCanvas(e.clientX, e.clientY)) return
      targetPitch = DEFAULT_PITCH
      targetYaw = DEFAULT_YAW
      velPitch = 0
      velYaw = 0
      surgeHeat = 0.65
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
    window.addEventListener('touchstart', handlePointerDown, { passive: true })
    window.addEventListener('touchmove', handlePointerMove, { passive: true })
    window.addEventListener('touchend', handlePointerUp)
    window.addEventListener('dblclick', handleDoubleClick)

    fit()
    igniteInstant()
    if (!reduce) raf = requestAnimationFrame(frame)

    const ro = new ResizeObserver(() => {
      if (fit()) igniteInstant()
    })
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
      window.removeEventListener('touchstart', handlePointerDown)
      window.removeEventListener('touchmove', handlePointerMove)
      window.removeEventListener('touchend', handlePointerUp)
      window.removeEventListener('dblclick', handleDoubleClick)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="cpu-burn"
      style={{
        width: '100%',
        height: '100%',
        minHeight: '420px',
        display: 'block',
        pointerEvents: 'auto',
        cursor: 'grab',
        imageRendering: 'pixelated',
      }}
      aria-hidden="true"
    />
  )
}

export const BurningCpu = BurningDataCenterMachine
export default BurningDataCenterMachine