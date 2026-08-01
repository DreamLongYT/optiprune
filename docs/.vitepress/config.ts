import { defineConfig } from 'vitepress'

export default defineConfig({
  // 1. Tell VitePress your site is deployed at https://<user>.github.io/optiprune/
  base: '/optiprune/',

  title: "Optiprune",
  description: "Resilient static dead-code analyzer for TypeScript and JavaScript workspaces.",
  
  // Favicon setup (docs/public/logo.svg)
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }]
  ],

  themeConfig: {
    // Top-left navbar logo
    logo: '/logo.svg',

    // 2. Use relative paths starting with '/' - VitePress will automatically prefix base URL
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide' },
      { text: 'Architecture', link: '/architecture' }
    ],

    sidebar: [
      {
        text: 'Documentation',
        items: [
          { text: 'Getting Started', link: '/guide' },
          { text: 'Architecture Layers', link: '/architecture' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/DreamLongYT/optiprune' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 DreamLong'
    },

    search: {
      provider: 'local'
    }
  }
})