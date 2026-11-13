import { getApiBaseUrl } from './api-base.ts';

/** Server-relative storage path served by `GET /api/storage/:bucket/:key`. */
export function isOverlordStorageUrl(url: string): boolean {
  return url.startsWith('/api/storage/');
}

/**
 * True when the SPA shell origin differs from the configured API base, so
 * `<img src>` / `<a href>` cannot reach stored bytes without an authenticated fetch.
 */
export function storageUrlNeedsAuthenticatedFetch({
  url,
  apiBaseUrl = getApiBaseUrl(),
  pageOrigin = typeof window !== 'undefined' ? window.location.origin : ''
}: {
  url: string;
  apiBaseUrl?: string;
  pageOrigin?: string;
}): boolean {
  if (!isOverlordStorageUrl(url)) return false;
  if (!apiBaseUrl || !pageOrigin) return false;
  try {
    return new URL(apiBaseUrl).origin !== pageOrigin;
  } catch {
    return false;
  }
}
