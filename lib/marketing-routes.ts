const MARKETING_EXACT_PATHS = new Set(['/']);

const MARKETING_PATH_PREFIXES = ['/about', '/changelog', '/compare', '/demo', '/problems'];

export function isMarketingRoute(pathname: string): boolean {
  if (MARKETING_EXACT_PATHS.has(pathname)) {
    return true;
  }

  return MARKETING_PATH_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
