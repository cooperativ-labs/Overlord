import path from 'node:path';

import { withSerwist } from '@serwist/turbopack';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is required.');
}
const supabaseHostname = new URL(supabaseUrl).hostname;

const securityHeaders = async () => [
  {
    source: '/(.*)',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
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
  experimental: {
    externalDir: true
  },
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
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
});
