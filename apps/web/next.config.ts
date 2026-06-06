import { withSentryConfig } from '@sentry/nextjs';
import { withSerwist } from '@serwist/turbopack';
import path from 'node:path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is required.');
}
const supabaseOrigin = new URL(supabaseUrl).origin;
const supabaseHostname = new URL(supabaseUrl).hostname;
const supabaseRealtimeOrigin = supabaseOrigin.replace(/^http/, 'ws');

const isDev = process.env.NODE_ENV === 'development';
const isPreview = process.env.VERCEL_ENV === 'preview';

const buildAppContentSecurityPolicy = () => {
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  const imgSrc = [
    "'self'",
    'data:',
    'blob:',
    supabaseOrigin,
    'https://cooperativ.io',
    'https://ovld.ai',
    'https://www.ovld.ai',
    'https://img.youtube.com',
    'https://api.qrserver.com'
  ];
  const connectSrc = [
    "'self'",
    supabaseOrigin,
    supabaseRealtimeOrigin,
    'https://*.ingest.us.sentry.io',
    'https://vitals.vercel-insights.com',
    'https://*.vercel-insights.com',
    'https://slack.com',
    'https://github.com',
    'https://bitbucket.org',
    'https://api.bitbucket.org'
  ];

  if (isDev) {
    scriptSrc.push("'unsafe-eval'");
    connectSrc.push(
      'http://localhost:*',
      'http://127.0.0.1:*',
      'ws://localhost:*',
      'ws://127.0.0.1:*'
    );
    imgSrc.push('http://localhost:*', 'http://127.0.0.1:*');
  }

  if (isDev || isPreview) {
    scriptSrc.push('https://vercel.live');
    connectSrc.push('https://vercel.live', 'wss://ws-us3.pusher.com');
  }

  const directives = [
    ['default-src', "'self'"],
    ['base-uri', "'self'"],
    ['script-src', ...scriptSrc],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', ...imgSrc],
    ['font-src', "'self'", 'data:'],
    ['media-src', "'self'", 'data:', 'blob:'],
    ['connect-src', ...connectSrc],
    ['frame-src', 'https://www.youtube.com'],
    ['frame-ancestors', "'none'"],
    [
      'form-action',
      "'self'",
      supabaseOrigin,
      'https://slack.com',
      'https://github.com',
      'https://bitbucket.org'
    ],
    ['object-src', "'none'"],
    ['worker-src', "'self'", 'blob:'],
    ['manifest-src', "'self'"]
  ];

  if (!isDev) {
    directives.push(['upgrade-insecure-requests']);
  }

  return directives
    .map(([directive, ...sources]) => `${directive} ${sources.join(' ')}`.trim())
    .join('; ');
};

const securityHeaders = async () => [
  {
    source: '/(.*)',
    headers: [
      { key: 'Content-Security-Policy', value: buildAppContentSecurityPolicy() },
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
      {
        key: 'Content-Security-Policy',
        value: isDev
          ? "default-src 'self'; script-src 'self' 'unsafe-eval'"
          : "default-src 'self'; script-src 'self'"
      }
    ]
  }
];

const nextConfig = withSerwist({
  allowedDevOrigins: ['127.0.0.1'],
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV
  },
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

export default withSentryConfig(nextConfig, {
  org: 'cooperativ-labs',
  project: 'overlord-webapp',
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  webpack: {
    automaticVercelMonitors: true,
    treeshake: {
      removeDebugLogging: true
    }
  }
});
