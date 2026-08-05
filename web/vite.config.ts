import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const devServerPort = Number(env.DEV_SERVER_PORT) || 5173
  const apiUrl = env.API_URL || 'http://localhost:5013'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: devServerPort,
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
        },
      },
    },
  }
})
