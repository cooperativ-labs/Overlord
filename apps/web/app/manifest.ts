import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Overlord AI',
    short_name: 'Overlord',
    description: 'Local-first AI agent management system',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#000000',
    icons: [
      {
        src: '/images/256.png',
        sizes: '256x256',
        type: 'image/png'
      },
      {
        src: '/images/512.png',
        sizes: '512x512',
        type: 'image/png'
      },
      {
        src: '/images/512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      },
      {
        src: '/images/1024.png',
        sizes: '1024x1024',
        type: 'image/png'
      }
    ]
  };
}
