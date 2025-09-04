import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://new-ai-seo-app-production.up.railway.app',
        changeOrigin: true,
        secure: true
      },
      '/auth': {
        target: 'https://new-ai-seo-app-production.up.railway.app',
        changeOrigin: true,
        secure: true
      },
      '/seo': {
        target: 'https://new-ai-seo-app-production.up.railway.app',
        changeOrigin: true,
        secure: true
      },
      '/plans': {
        target: 'https://new-ai-seo-app-production.up.railway.app',
        changeOrigin: true,
        secure: true
      },
      '/collections': {
        target: 'https://new-ai-seo-app-production.up.railway.app',
        changeOrigin: true,
        secure: true
      }
    }
  }
})
