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
        assetFileNames: `assets/[name]-[hash]-${Date.now()}.[ext]`,
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'polaris': ['@shopify/polaris'],
          'app-bridge': ['@shopify/app-bridge-react']
        }
      }
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://indexaize-aiseo-app-production.up.railway.app',
        changeOrigin: true,
        secure: true
      },
      '/auth': {
        target: 'https://indexaize-aiseo-app-production.up.railway.app',
        changeOrigin: true,
        secure: true
      },
      '/seo': {
        target: 'https://indexaize-aiseo-app-production.up.railway.app',
        changeOrigin: true,
        secure: true
      },
      '/plans': {
        target: 'https://indexaize-aiseo-app-production.up.railway.app',
        changeOrigin: true,
        secure: true
      },
      '/collections': {
        target: 'https://indexaize-aiseo-app-production.up.railway.app',
        changeOrigin: true,
        secure: true
      }
    }
  }
})