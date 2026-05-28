export const SESSION_ENDED_MESSAGE = 'You have been signed out. Please sign in again.';

const PUBLIC_EXACT_PATHS = new Set([
  '/',
  '/anatomy',
  '/changelog',
  '/compare',
  '/early-access',
  '/docs',
  '/llms.txt',
  '/llms-full.txt',
  '/overlord-context',
  '/robots.txt',
  '/sitemap.xml',
  '/unsubscribe'
]);
const PUBLIC_PATH_PREFIXES = [
  '/changelog/',
  '/docs/',
  '/agent-docs/',
  '/downloads/',
  '/login',
  '/signup',
  '/electron-login',
  '/confirm-email',
  '/onboarding',
  '/oauth/',
  '/oauth/consent',
  '/oauth/confirmation',
  '/auth',
  '/api/health',
  '/.well-known/',
  '/privacy',
  '/presentations/',
  '/about',
  '/problems/',
  '/terms',
  '/api/auth',
  '/callback',

  '/compare/',
  '/demo'
];

export function isPublicRoute(pathname: string): boolean {
  return (
    PUBLIC_EXACT_PATHS.has(pathname) || PUBLIC_PATH_PREFIXES.some(path => pathname.startsWith(path))
  );
}
