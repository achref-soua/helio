import type { MetadataRoute } from 'next';

/**
 * PWA manifest (K2): installs Helio as its own app with the logo on
 * desktop and mobile. Deliberately no service worker — Helio is a live
 * data dashboard, and an offline shell of stale numbers would mislead;
 * installability only needs the manifest in Chromium-family browsers.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Helio',
    short_name: 'Helio',
    description: 'The open-source growth platform.',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf6f0',
    theme_color: '#f59e0b',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
