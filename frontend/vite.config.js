import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const PS5_IP = env.VITE_PS5_IP || '192.168.50.235'
  const MAIN_PORT = env.VITE_MAIN_PORT || 9090
  const DAEMON_PORT = env.VITE_DAEMON_PORT || 6701

  return {
    plugins: [react(), viteSingleFile()],
    build: {
      target: ['es2015', 'safari12'],
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
        format: {
          comments: false,
        },
      },
      cssCodeSplit: false,
      assetsInlineLimit: 100000, // Inline all assets
    },
    server: {
      watch: {
        usePolling: true,
      },
      proxy: {
        '/getip': { target: `http://${PS5_IP}:${DAEMON_PORT}`, changeOrigin: true },
        '/version': { target: `http://${PS5_IP}:${DAEMON_PORT}`, changeOrigin: true },
        '/__local__': { target: `http://${PS5_IP}:${MAIN_PORT}`, changeOrigin: true },
        '/speedtest': { target: `http://${PS5_IP}:${MAIN_PORT}`, changeOrigin: true },
        '/speedtest_download': { target: `http://${PS5_IP}:${MAIN_PORT}`, changeOrigin: true },
        '/speedtest_multipart': { target: `http://${PS5_IP}:${MAIN_PORT}`, changeOrigin: true },
        '/debug': { target: `http://${PS5_IP}:${MAIN_PORT}`, changeOrigin: true },
        '/mem': { target: `http://${PS5_IP}:${DAEMON_PORT}`, changeOrigin: true }
      }
    }
  }
})
