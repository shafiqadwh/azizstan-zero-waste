import type { MetadataRoute } from 'next';

/** PWA manifest (07-frontend, T26): installable app that opens on the user's home page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AZIZSTAN ZERO WASTE',
    short_name: 'ZERO WASTE',
    description: 'ระบบประเมินความสะอาดห้องเรียนและพื้นที่ โรงเรียนมูลนิธิอาซิซสถาน',
    lang: 'th',
    start_url: '/login',
    scope: '/',
    display: 'standalone',
    background_color: '#F5F4EF',
    theme_color: '#1D6A4E',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
