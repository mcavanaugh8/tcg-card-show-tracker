import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['app-icon.svg'],
    manifest: {
      name: 'Tabletop Ledger',
      short_name: 'Ledger',
      description: 'Offline inventory, profit, and trade tracking for TCG show vendors.',
      theme_color: '#0d3028',
      background_color: '#f5f4ee',
      display: 'standalone',
      start_url: '/',
      icons: [{ src: '/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,json,svg,webmanifest}'],
      maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      navigateFallback: '/index.html',
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          urlPattern: /^https:\/\/cdn\.tcgtracking\.com\/product\//,
          handler: 'CacheFirst',
          options: { cacheName: 'tcg-product-images', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 } },
        },
        {
          urlPattern: /^https:\/\/tcgtracking\.com\/tcgapi\/v1\/products\//,
          handler: 'NetworkFirst',
          options: { cacheName: 'tcg-product-details', networkTimeoutSeconds: 4, expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 7 } },
        },
      ],
    },
  })],
})
