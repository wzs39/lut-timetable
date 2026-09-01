import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    // Port tetap 5210 + strictPort: jangan diam-diam pindah port kalau
    // terjadi konflik (preview terdaftar di URL tetap). Kalau bentrok,
    // hentikan proses lama dulu.
    port: 5210,
    strictPort: true,
    host: 'localhost',
    proxy: {
      // Browser-dev proxy untuk menghindari CORS (di Android/Windows native
      // request langsung via CapacitorHttp, tanpa proxy ini).
      '/proxy/sisu': {
        target: 'https://sisu.lut.fi',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/sisu/, ''),
      },
      '/proxy/timeedit': {
        target: 'https://cloud.timeedit.net',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/timeedit/, ''),
      },
    },
  },
})
