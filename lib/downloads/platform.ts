export type DetectedDesktopPlatform = 'linux' | 'macos' | 'unknown' | 'windows';

export function detectDesktopPlatform(userAgent: string): DetectedDesktopPlatform {
  const normalizedUserAgent = userAgent.toLowerCase();

  if (!normalizedUserAgent) {
    return 'unknown';
  }

  if (normalizedUserAgent.includes('windows')) {
    return 'windows';
  }

  if (normalizedUserAgent.includes('mac os x') || normalizedUserAgent.includes('macintosh')) {
    return 'macos';
  }

  if (normalizedUserAgent.includes('linux') && !normalizedUserAgent.includes('android')) {
    return 'linux';
  }

  return 'unknown';
}
