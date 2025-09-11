import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-1757570000000.js`,
        chunkFileNames: `assets/[name]-[hash]-1757570000000.js`,
        assetFileNames: `assets/[name]-[hash]-1757570000000.[ext]`
      }
    }
  },
  define: {
    'process.env': process.env,
    '__BUILD_TIME__': JSON.stringify('2025-01-11T12:00:00.000Z'),
    '__CACHE_BUST__': JSON.stringify('1757570000000')
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
