import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';

const supabaseHostname = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : 'zitmmhvbilhjjdwgxlfm.supabase.co';

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

export default withSerwist({
  reactStrictMode: true,
  output: 'standalone',
  headers: securityHeaders,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: supabaseHostname,
        pathname: '/storage/v1/object/public/**'
      },
      {
        protocol: 'https',
        hostname: 'cooperativ.io'
      },
      {
        protocol: 'https',
        hostname: 'ovld.ai'
      },
      {
        protocol: 'http',
        hostname: '127.0.0.1'
      },
      {
        protocol: 'http',
        hostname: 'localhost'
      }
    ]
  }
} as any as NextConfig);
