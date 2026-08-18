import { useEffect, useState } from 'react';

import { fetchApi } from './api-transport.ts';
import { isOverlordStorageUrl, storageUrlNeedsAuthenticatedFetch } from './storage-url.ts';

const failedAuthenticatedMediaUrls = new Set<string>();
const inFlightAuthenticatedMediaFetches = new Map<string, Promise<Blob | null>>();

/**
 * Bounded cache of resolved `blob:` URLs, keyed by the source storage URL.
 *
 * Without it every mount of every `<Avatar>` in remote mode re-downloaded the
 * same image and allocated a fresh object URL — a list that remounts as the
 * realtime link invalidates queries re-fetches the same handful of avatars
 * indefinitely, and each in-flight blob is held in the renderer heap. Entries
 * are kept in insertion order and the oldest is revoked once the cache is full,
 * so the retained set has a hard ceiling instead of tracking how long the app
 * has been open.
 */
const MAX_CACHED_MEDIA_OBJECT_URLS = 64;
const authenticatedMediaObjectUrls = new Map<string, string>();

function readCachedObjectUrl(url: string): string | null {
  const cached = authenticatedMediaObjectUrls.get(url);
  if (!cached) return null;
  // Refresh recency so the avatars actually on screen are the last to be evicted.
  authenticatedMediaObjectUrls.delete(url);
  authenticatedMediaObjectUrls.set(url, cached);
  return cached;
}

function cacheObjectUrl(url: string, objectUrl: string): void {
  authenticatedMediaObjectUrls.set(url, objectUrl);
  while (authenticatedMediaObjectUrls.size > MAX_CACHED_MEDIA_OBJECT_URLS) {
    const oldest = authenticatedMediaObjectUrls.keys().next();
    if (oldest.done) break;
    const evicted = authenticatedMediaObjectUrls.get(oldest.value);
    authenticatedMediaObjectUrls.delete(oldest.value);
    if (evicted) URL.revokeObjectURL(evicted);
  }
}

async function fetchAuthenticatedMediaBlob(url: string): Promise<Blob | null> {
  const existing = inFlightAuthenticatedMediaFetches.get(url);
  if (existing) return existing;

  const request = (async () => {
    const response = await fetchApi(url);
    if (!response.ok) {
      failedAuthenticatedMediaUrls.add(url);
      return null;
    }
    return await response.blob();
  })();

  inFlightAuthenticatedMediaFetches.set(url, request);
  try {
    return await request;
  } finally {
    inFlightAuthenticatedMediaFetches.delete(url);
  }
}

/**
 * Resolves a profile/attachment/storage URL for rendering. Overlord storage paths
 * stay relative when the shell shares an origin (or dev proxy) with the API; in
 * desktop remote mode they are fetched with bearer auth and exposed as blob URLs.
 */
export function useAuthenticatedMediaUrl(url: string | null | undefined): string | null {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() => {
    if (!url) return null;
    if (!isOverlordStorageUrl(url) || !storageUrlNeedsAuthenticatedFetch({ url })) return url;
    return readCachedObjectUrl(url);
  });

  useEffect(() => {
    if (!url) {
      setResolvedUrl(null);
      return;
    }

    if (!isOverlordStorageUrl(url) || !storageUrlNeedsAuthenticatedFetch({ url })) {
      setResolvedUrl(url);
      return;
    }
    if (failedAuthenticatedMediaUrls.has(url)) {
      setResolvedUrl(null);
      return;
    }

    const cached = readCachedObjectUrl(url);
    if (cached) {
      setResolvedUrl(cached);
      return;
    }

    setResolvedUrl(null);
    let cancelled = false;

    void (async () => {
      try {
        const blob = await fetchAuthenticatedMediaBlob(url);
        if (!blob) return;
        // The object URL is owned by the cache, not by this mount: two avatars
        // pointing at the same person share one, and unmounting either must not
        // revoke a URL the other is still rendering. Eviction is the only revoke.
        const objectUrl = readCachedObjectUrl(url) ?? URL.createObjectURL(blob);
        cacheObjectUrl(url, objectUrl);
        if (!cancelled) setResolvedUrl(objectUrl);
      } catch {
        if (!cancelled) setResolvedUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return resolvedUrl;
}
