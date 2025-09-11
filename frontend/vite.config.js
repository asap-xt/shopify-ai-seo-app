import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
        chunkFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
        assetFileNames: `assets/[name]-[hash]-${Date.now()}.[ext]`
      }
    }
  },
  define: {
    'process.env': process.env,
    '__BUILD_TIME__': JSON.stringify(new Date().toISOString()),
    '__CACHE_BUST__': JSON.stringify(Date.now().toString())
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
