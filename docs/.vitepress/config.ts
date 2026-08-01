import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "Optiprune",
  description: "Resilient static dead-code analyzer for TypeScript and JavaScript workspaces.",
  
  // Favicon setup (docs/public/logo.svg)
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }]
  ],

  themeConfig: {
    // Top-left navbar logo
    logo: '/logo.svg',

    nav: [
      { text: 'Home', link: 'optiprune/' },
      { text: 'Guide', link: 'optiprune/guide' },
      { text: 'Architecture', link: 'optiprune/architecture' }
    ],

    sidebar: [
      {
        text: 'Documentation',
        items: [
          { text: 'Getting Started', link: 'optiprune/guide' },
          { text: 'Architecture Layers', link: 'optiprune/architecture' }
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