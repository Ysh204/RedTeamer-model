import { execSync } from 'node:child_process'
import os from 'node:os'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

function resolveBackendTarget(): string {
  if (process.env.BACKEND_URL) {
    return process.env.BACKEND_URL
  }

  // If Vite is running inside WSL, 127.0.0.1 connects to WSL's own loopback.
  // The Windows host running the Python server is reachable via the default gateway.
  if (process.platform === 'linux') {
    try {
      const release = os.release().toLowerCase()
      if (release.includes('microsoft') || release.includes('wsl')) {
        const route = execSync('ip route', { timeout: 1000 }).toString()
        const match = route.match(/default via (\S+)/)
        if (match && match[1]) {
          const target = `http://${match[1]}:8000`
          console.log(`[vite] WSL detected: routing /api to Windows host at ${target}`)
          return target
        }
      }
    } catch {
      // Fallback to default loopback
    }
  }

  return 'http://127.0.0.1:8000'
}

const backendTarget = resolveBackendTarget()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
})

