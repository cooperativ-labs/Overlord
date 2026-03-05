import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development'
});

const securityHeaders = async () => [
  {
    source: '/(.*)',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
    ]
  },
  {
    source: '/sw.js',
    headers: [
      { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" }
    ]
  }
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  headers: securityHeaders,
  // Use webpack for production builds with Serwist (Turbopack not yet supported)
  // The webpack config is injected by @serwist/next
  turbopack: {
    // Empty config tells Next.js we're aware of Turbopack but using webpack via Serwist
  }
};

export default withSerwist(nextConfig);
