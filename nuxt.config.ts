// https://nuxt.com/docs/api/configuration/nuxt-config
import { resolve } from 'node:path'
import pkg from './package.json'

export default defineNuxtConfig({
  runtimeConfig: {
    // Absolute path to the SQLite database, anchored to the project root at
    // config-load time. The production server (nuxt preview) chdirs into
    // .output, so process.cwd() at runtime is NOT the project root — the DB
    // path must be baked here, never derived from runtime cwd.
    // Override with the DB_PATH env var.
    dbPath: process.env.DB_PATH || resolve(process.cwd(), 'data', 'pulse-trader.db'),
    public: {
      appVersion: pkg.version,
      appName: pkg.name,
    },
  },

  srcDir: 'src/app',
  serverDir: 'src/server',
  dir: {
    public: 'src/public',
  },
  compatibilityDate: '2025-07-15',

  app: {
    baseURL: '/',
    head: {
      title: 'Pulse Trader',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Pulse Trader — Afrihandel' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
        { rel: 'icon', type: 'image/png', sizes: '48x48', href: '/favicon-48.png' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/favicon-192.png' },
        { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/favicon-512.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
    },
  },

  typescript: {
    typeCheck: false,
  },

  devtools: { enabled: true },

  devServer: {
    port: 4000,
  },

  vite: {
    optimizeDeps: {
      include: ['lightweight-charts'],
    },
  },
})
