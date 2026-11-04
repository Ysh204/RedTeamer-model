import { useEffect, useRef } from 'react'

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

export function BurningCpu() {
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
    let cpuMask = new Uint8Array(0)
    let burnZone = new Float32Array(0)
    let depthBuf = new Float32Array(0)
    let emitterList = new Int32Array(0)
    let emitterCount = 0
    let pixels: ImageData | null = null

    // Sleek foreshortened 3D perspective angle
    const DEFAULT_PITCH = 0.82
    const DEFAULT_YAW = -0.66
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

    let cpuCenterX = 0
    let cpuCenterY = 0
    let cpuRadius = 60
    let cpuSpanX = 60

    // Pre-generate iconic 3D CPU textures (160x160):
    // Smooth brushed-metal IHS heat spreader plate with chamfered corners, side indents,
    // front Pin-1 fiducial dot, subtle laser-etched text bars, stepped IHS flange,
    // dark PCB wafer with gold contact pads & Pin-1 corner triangle, and underside PGA pins
    const TEX_SIZE = 160
    const lidTex = new Float32Array(TEX_SIZE * TEX_SIZE)
    const lidMaskTex = new Uint8Array(TEX_SIZE * TEX_SIZE)
    const flangeMaskTex = new Uint8Array(TEX_SIZE * TEX_SIZE)
    const pcbTex = new Float32Array(TEX_SIZE * TEX_SIZE)

    for (let ty = 0; ty < TEX_SIZE; ty++) {
      for (let tx = 0; tx < TEX_SIZE; tx++) {
        const u = tx / (TEX_SIZE - 1)
        const v = ty / (TEX_SIZE - 1)
        const idx = ty * TEX_SIZE + tx
        const ax = Math.abs(u - 0.5) * 2
        const ay = Math.abs(v - 0.5) * 2
        const maxC = Math.max(ax, ay)

        // 1. Clean Iconic CPU PCB Substrate Wafer
        let pcb = 0.12
        if (maxC > 0.96) {
          pcb = 0.88
        } else if (maxC > 0.88 && maxC <= 0.94) {
          const inPadSpanX = ax < 0.82 && tx % 4 < 2
          const inPadSpanY = ay < 0.82 && ty % 4 < 2
          if ((ay > 0.88 && inPadSpanX) || (ax > 0.88 && inPadSpanY)) {
            pcb = 0.85
          }
        }
        // Iconic Pin-1 gold corner triangle at the front vertex
        if (u < 0.17 && v > 0.83 && u + (1 - v) < 0.19) {
          pcb = 0.96
        }
        // Subtle micro-traces on PCB shoulder
        if (maxC >= 0.76 && maxC <= 0.86) {
          if ((tx % 8 === 0 && ax < 0.7) || (ty % 8 === 0 && ay < 0.7)) {
            pcb = 0.26
          }
        }
        pcbTex[idx] = pcb

        // 2. Stepped Metallic IHS Flange Base Shoulder
        if (ax + ay <= 1.78 && maxC <= 0.96) {
          flangeMaskTex[idx] = 1
        }

        // 3. Smooth Brushed-Metal CPU Integrated Heat Spreader (IHS) Plate
        const ihsCorner = ax + ay > 1.74
        const sideIndent = (ay < 0.26 && ax > 0.9) || (ax < 0.26 && ay > 0.9)
        if (ihsCorner || sideIndent) {
          lidMaskTex[idx] = 0
          lidTex[idx] = 0
          continue
        }
        lidMaskTex[idx] = 1

        const grad = 0.86 - (u * 0.1 + v * 0.08)
        const brush = Math.sin((u + v) * 90.0) * 0.018
        let ihs = grad + brush

        // Crisp chamfered perimeter highlight & subtle inner bevel line
        if (
          maxC > 0.93 ||
          ax + ay > 1.68 ||
          (ay < 0.28 && ax > 0.86) ||
          (ax < 0.28 && ay > 0.86)
        ) {
          ihs = 0.98
        } else if (maxC > 0.89 || ax + ay > 1.63) {
          ihs = 0.42
        }

        // Iconic small dark Pin-1 fiducial circle in the front corner of the metallic IHS plate
        const holeDistSq = (u - 0.18) * (u - 0.18) + (v - 0.82) * (v - 0.82)
        if (holeDistSq < 0.0011) {
          ihs = 0.08
        } else if (holeDistSq < 0.0018) {
          ihs = 0.96
        }

        // Subtle laser-etched processor spec markings in the center of the lid
        if (u > 0.3 && u < 0.7 && v > 0.38 && v < 0.64) {
          const lineY = Math.floor((v - 0.38) * 34)
          const colX = Math.floor((u - 0.3) * 44)
          if (lineY === 1 || lineY === 3 || lineY === 6 || lineY === 8) {
            const maxLen = lineY === 1 || lineY === 6 ? 0.62 : lineY === 8 ? 0.54 : 0.68
            if (u < maxLen && ((colX * 29 + lineY * 7) & 3) !== 0) {
              ihs = 0.48
            }
          }
        }

        lidTex[idx] = Math.max(0.08, Math.min(0.99, ihs))
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
      cpuMask = new Uint8Array(size)
      burnZone = new Float32Array(size)
      depthBuf = new Float32Array(size)
      emitterList = new Int32Array(size)
      pixels = ctx.createImageData(w, h)
      lastRasterPitch = -999
      lastRasterYaw = -999
      return true
    }

    const rasterize3DCpu = () => {
      if (
        Math.abs(pitch - lastRasterPitch) < 0.0008 &&
        Math.abs(yaw - lastRasterYaw) < 0.0008
      ) {
        return
      }
      lastRasterPitch = pitch
      lastRasterYaw = yaw

      luma.fill(0)
      cpuMask.fill(0)
      burnZone.fill(0)
      depthBuf.fill(-1e9)

      const aspect = w / Math.max(1, h)
      const screenCx = aspect > 1.38 ? w * 0.64 : w * 0.52
      const screenCy = h * 0.67
      const radius = Math.min(w * 0.285, h * 0.215)

      cpuCenterX = screenCx
      cpuCenterY = screenCy
      cpuRadius = radius
      cpuSpanX = radius * 1.15

      const cosY = Math.cos(yaw)
      const sinY = Math.sin(yaw)
      const cosP = Math.cos(pitch)
      const sinP = Math.sin(pitch)

      const project = (lx: number, ly: number, lz: number) => {
        const rx = lx * cosY - ly * sinY
        const ry = lx * sinY + ly * cosY
        const py = ry * cosP - lz * sinP
        const pz = ry * sinP + lz * cosP
        const persp = 1 / (1 - pz * 0.16)
        return {
          sx: screenCx + rx * radius * persp,
          sy: screenCy + py * radius * persp,
          sz: pz,
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
                cpuMask[idx] = res.mask
              }
            }
          }
        }

        rasterTri(p00, 0, 0, p10, 1, 0, p11, 1, 1)
        rasterTri(p00, 0, 0, p11, 1, 1, p01, 0, 1)
      }

      const specBoost = Math.max(0, cosP * 0.82 - sinP * 0.22)

      // 1. Bottom Gold Pin Grid Array (PGA) legs
      const pgaR = 0.95
      const p00 = project(-pgaR, -pgaR, -0.22)
      const p10 = project(pgaR, -pgaR, -0.22)
      const p11 = project(pgaR, pgaR, -0.22)
      const p01 = project(-pgaR, pgaR, -0.22)

      const b00 = project(-1, -1, -0.12)
      const b10 = project(1, -1, -0.12)
      const b11 = project(1, 1, -0.12)
      const b01 = project(-1, 1, -0.12)

      const pinSkirtShader = (light: number) => (u: number, v: number) => {
        const pinCol = ((u * 32) | 0) % 2 === 0
        const pinRow = ((v * 6) | 0) % 2 === 0
        const val = pinCol ? (pinRow ? 0.94 * light : 0.35 * light) : 0.06
        return { l: val, burn: 0.0, mask: 1 }
      }
      drawQuad(b00, b10, p10, p00, pinSkirtShader(0.75))
      drawQuad(b10, b11, p11, p10, pinSkirtShader(1.0))
      drawQuad(b11, b01, p01, p11, pinSkirtShader(0.92))
      drawQuad(b01, b00, p00, b01, pinSkirtShader(0.65))

      // 2. PCB Fiberglass Wafer Sidewalls & Top Rim
      const t00 = project(-1, -1, -0.01)
      const t10 = project(1, -1, -0.01)
      const t11 = project(1, 1, -0.01)
      const t01 = project(-1, 1, -0.01)

      const pcbWallShader = (sideLight: number) => (u: number, v: number) => {
        const val = (v < 0.25 ? 0.9 : ((u * 28) | 0) % 2 === 0 ? 0.58 : 0.14) * sideLight
        return { l: val, burn: 0.0, mask: 1 }
      }
      drawQuad(t00, t10, b10, b00, pcbWallShader(0.76))
      drawQuad(t10, t11, b11, b10, pcbWallShader(1.0))
      drawQuad(t11, t01, b01, b11, pcbWallShader(0.9))
      drawQuad(t01, t00, b00, b01, pcbWallShader(0.62))

      drawQuad(t00, t10, t11, t01, (u, v) => {
        const tx = Math.min(TEX_SIZE - 1, (u * TEX_SIZE) | 0)
        const ty = Math.min(TEX_SIZE - 1, (v * TEX_SIZE) | 0)
        const base = pcbTex[ty * TEX_SIZE + tx] * (0.8 + specBoost * 0.28)
        return { l: Math.min(1, base), burn: 0.0, mask: 1 }
      })

      // 3. Stepped Metallic IHS Flange Shoulder (z = -0.01 to +0.05)
      const flR = 0.83
      const fb00 = project(-flR, -flR, -0.01)
      const fb10 = project(flR, -flR, -0.01)
      const fb11 = project(flR, flR, -0.01)
      const fb01 = project(-flR, flR, -0.01)

      const ft00 = project(-flR, -flR, 0.05)
      const ft10 = project(flR, -flR, 0.05)
      const ft11 = project(flR, flR, 0.05)
      const ft01 = project(-flR, flR, 0.05)

      const flangeWallShader = (lt: number) => (u: number) =>
        u < 0.06 || u > 0.94 ? null : { l: 0.45 * lt, burn: 0.0, mask: 2 }
      drawQuad(ft00, ft10, fb10, fb00, flangeWallShader(0.72))
      drawQuad(ft10, ft11, fb11, fb10, flangeWallShader(0.95))
      drawQuad(ft11, ft01, fb01, fb11, flangeWallShader(0.85))
      drawQuad(ft01, ft00, fb00, fb01, flangeWallShader(0.6))

      drawQuad(ft00, ft10, ft11, ft01, (u, v) => {
        const tx = Math.min(TEX_SIZE - 1, (u * TEX_SIZE) | 0)
        const ty = Math.min(TEX_SIZE - 1, (v * TEX_SIZE) | 0)
        if (flangeMaskTex[ty * TEX_SIZE + tx] === 0) return null
        const maxD = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2
        return { l: maxD < 0.92 ? 0.34 : 0.84, burn: 0.0, mask: 2 }
      })

      // 4. Raised Smooth Metallic IHS Plate (z = +0.05 to +0.16)
      const ihsR = 0.74
      const ib00 = project(-ihsR, -ihsR, 0.05)
      const ib10 = project(ihsR, -ihsR, 0.05)
      const ib11 = project(ihsR, ihsR, 0.05)
      const ib01 = project(-ihsR, ihsR, 0.05)

      const it00 = project(-ihsR * 0.95, -ihsR * 0.95, 0.16)
      const it10 = project(ihsR * 0.95, -ihsR * 0.95, 0.16)
      const it11 = project(ihsR * 0.95, ihsR * 0.95, 0.16)
      const it01 = project(-ihsR * 0.95, ihsR * 0.95, 0.16)

      const bevelShader = (light: number) => (u: number, v: number) => {
        if (u < 0.06 || u > 0.94) return null
        const rimHighlight = v < 0.3 ? 0.95 : 0.52 * light + specBoost * 0.2
        return { l: Math.min(0.98, rimHighlight), burn: 0.35, mask: 2 }
      }
      drawQuad(it00, it10, ib10, ib00, bevelShader(0.78))
      drawQuad(it10, it11, ib11, ib10, bevelShader(1.05))
      drawQuad(it11, it01, ib01, ib11, bevelShader(0.94))
      drawQuad(it01, it00, ib00, ib01, bevelShader(0.64))

      drawQuad(it00, it10, it11, it01, (u, v) => {
        const tx = Math.min(TEX_SIZE - 1, (u * TEX_SIZE) | 0)
        const ty = Math.min(TEX_SIZE - 1, (v * TEX_SIZE) | 0)
        const tIdx = ty * TEX_SIZE + tx
        if (lidMaskTex[tIdx] === 0) return null

        const sheen = Math.max(
          0,
          1 - Math.hypot(u - (0.42 - sinY * 0.28), v - (0.48 - sinP * 0.28)) * 1.15
        )
        const base = lidTex[tIdx] * (0.82 + specBoost * 0.25) + sheen * 0.14
        const dc = Math.hypot(u - 0.54, v - 0.44)
        const upperBias = Math.max(0, Math.min(1, (0.68 - v + (u - 0.35) * 0.55) * 1.45))
        const coreBurn = dc < 0.32 ? 1.0 : dc < 0.56 ? 0.9 * upperBias : 0.35 * upperBias
        return {
          l: Math.max(0.08, Math.min(0.99, base)),
          burn: coreBurn,
          mask: dc < 0.34 ? 3 : 2,
        }
      })

      // Build compact list of active fire-emitting CPU pixels for O(N_emitter) seeding
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
        const m = cpuMask[i]
        const isIhsEdge =
          m >= 2 &&
          (cpuMask[i - 1] !== m ||
            cpuMask[i + 1] !== m ||
            cpuMask[i - w] !== m ||
            cpuMask[i + w] !== m)

        const n1 = fastFbm(x * 0.045 + t * 0.75, y * 0.045 - t * 1.6)
        const n2 = fastNoise(x * 0.11 - t * 1.2, y * 0.11 - t * 2.3)

        if (isIhsEdge && bz > 0.25) {
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
      const decayScale = 1 / Math.max(0.55, Math.min(1.75, 1.2 + surgeHeat * 0.65))

      for (let y = 0; y < h - 3; y++) {
        const row = y * w
        const heightFrac = Math.max(0, (cpuCenterY - y) / Math.max(1, cpuCenterY))
        const chimneyWave = Math.sin(heightFrac * 4.8 - t * 2.1) * (5.5 * heightFrac)
        const maxSpanInv = 1 / Math.max(1, cpuSpanX * (1.06 - heightFrac * 0.15))

        for (let x = 2; x < w - 2; x++) {
          const i = row + x
          const swirl = (fastFbm(x * 0.032 + t * 0.65, y * 0.028 + t * 1.8) - 0.5) * 4.8
          const centerPull = (x - (cpuCenterX + chimneyWave)) * 0.015 * heightFrac
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
          const edgeDx = Math.abs(x - (cpuCenterX + chimneyWave)) * maxSpanInv
          const sideCooling = edgeDx > 0.82 ? (edgeDx - 0.82) * 4.2 : 0
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
      const invBackSpan = 1 / Math.max(1, cpuRadius * 0.58)

      for (let y = 0; y < h; y++) {
        const row = y * w
        const backHeightFactor = Math.max(0, Math.min(1, (cpuCenterY - y) * invBackSpan))

        for (let x = 0; x < w; x++) {
          const i = row + x
          const p = i * 4
          const rawCell = heat[i] / 255
          const spark = ember[i] / 255
          const isCpu = cpuMask[i] > 0
          const base = luma[i]

          if (!isCpu && rawCell < 0.035 && spark < 0.08) {
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
          if (isCpu) {
            const bz = burnZone[i]
            const melt = Math.max(0, Math.min(1, (rawCell - 0.22) / 0.78)) * bz * bz
            let cpuG = base

            if (melt > 0.15 && base < 0.92) {
              const charMask = Math.max(0, (smokeField - 0.42) * 2.5)
              if (charMask > 0.48) {
                cpuG = base * 0.25 + (1 - Math.min(1, charMask)) * 0.22
              } else {
                const ridge = Math.max(0, Math.min(1, 1 - charMask * 1.35))
                cpuG = base * (1 - melt * 0.65) + melt * ridge * 1.05
              }
            }

            const backBlend = backHeightFactor * Math.min(1, rawCell * 1.5)
            const blended = cpuG * (1 - backBlend * 0.88) + plumeG * (backBlend * 0.88)
            g = Math.max(cpuG * (1 - backBlend * 0.45), blended)
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

    // Instant <5ms analytical plume ignition on mount (eliminates the 5-second startup delay!)
    const igniteInstant = () => {
      rasterize3DCpu()
      heat.fill(0)
      const maxY = Math.min(h - 4, Math.floor(cpuCenterY + cpuRadius * 0.35))
      for (let y = 0; y < maxY; y++) {
        const row = y * w
        const heightFrac = Math.max(0, (cpuCenterY - y) / Math.max(1, cpuCenterY))
        const wave = Math.sin(heightFrac * 4.5) * (5.0 * heightFrac)
        const halfSpan = cpuSpanX * (0.76 - heightFrac * 0.24)
        const minX = Math.max(2, Math.floor(cpuCenterX + wave - halfSpan))
        const maxX = Math.min(w - 3, Math.ceil(cpuCenterX + wave + halfSpan))
        for (let x = minX; x <= maxX; x++) {
          const dx = Math.abs(x - (cpuCenterX + wave)) / Math.max(1, halfSpan)
          const n = fastFbm(x * 0.04, y * 0.035)
          const envelope = Math.max(0, 1 - dx * dx) * (1 - heightFrac * 0.55)
          const val = (envelope * 210 + (n - 0.35) * 120)
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
        const idleBreathP = Math.sin(tick * 0.018) * 0.022
        const idleBreathY = Math.cos(tick * 0.014) * 0.032
        velYaw *= 0.88
        velPitch *= 0.88
        yaw += velYaw + (targetYaw + idleBreathY - yaw) * 0.1
        pitch += velPitch + (targetPitch + idleBreathP - pitch) * 0.1
      }
      pitch = Math.max(0.42, Math.min(1.2, pitch))

      rasterize3DCpu()
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
        velPitch = dy * 0.009
        yaw += velYaw
        pitch = Math.max(0.42, Math.min(1.2, pitch + velPitch))
        targetYaw = yaw
        targetPitch = pitch
        mouseWindX = Math.max(-2.8, Math.min(2.8, dx * 0.15))
      } else if (isPointNearCanvas(clientX, clientY)) {
        const nx = ((clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2
        const ny = ((clientY - rect.top) / Math.max(1, rect.height) - 0.65) * 2
        const dx = clientX - lastMouseX
        lastMouseX = clientX
        lastMouseY = clientY
        if (Math.abs(dx) < 80) {
          mouseWindX = Math.max(-2.0, Math.min(2.0, mouseWindX * 0.72 + dx * 0.065))
        }
        targetYaw = DEFAULT_YAW + nx * 0.32
        targetPitch = Math.max(0.48, Math.min(1.12, DEFAULT_PITCH + ny * 0.2))
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

export default BurningCpu