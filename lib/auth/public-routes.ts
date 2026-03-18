export const SESSION_ENDED_MESSAGE = 'You have been signed out. Please sign in again.';

const PUBLIC_EXACT_PATHS = new Set(['/']);
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/signup',
  '/electron-login',
  '/confirm-email',
  '/onboarding',
  '/oauth/',
  '/oauth/consent',
  '/oauth/confirmation',
  '/auth',
  '/.well-known/',
  '/privacy',
  '/terms',
  '/api/auth',
  '/callback'
];

export function isPublicRoute(pathname: string): boolean {
  return (
    PUBLIC_EXACT_PATHS.has(pathname) || PUBLIC_PATH_PREFIXES.some(path => pathname.startsWith(path))
  );
}
