// https://nuxt.com/docs/api/configuration/nuxt-config
import pkg from './package.json'

export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      appVersion: pkg.version,
      appName: pkg.name,
    },
  },

  srcDir: 'src/app',
  serverDir: 'src/server',
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
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
        { rel: 'icon', type: 'image/png', sizes: '48x48', href: '/favicon-48.png' },
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
