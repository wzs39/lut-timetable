import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    // 应用版本号（取自 package.json），供「检查更新」横幅显示当前版本。
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
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
      '/proxy/moodle': {
        target: 'https://moodle.lut.fi',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/moodle/, ''),
      },
    },
  },
})
