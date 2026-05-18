export const SESSION_ENDED_MESSAGE = 'You have been signed out. Please sign in again.';

const PUBLIC_EXACT_PATHS = new Set([
  '/',
  '/compare',
  '/early-access',
  '/docs',
  '/llms.txt',
  '/llms-full.txt',
  '/overlord-context',
  '/robots.txt',
  '/sitemap.xml'
]);
const PUBLIC_PATH_PREFIXES = [
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
