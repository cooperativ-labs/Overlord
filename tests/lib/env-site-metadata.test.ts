import { getSiteMetadataBaseUrl } from '@/lib/env';

describe('getSiteMetadataBaseUrl', () => {
  const originalSite = process.env.NEXT_PUBLIC_SITE_URL;
  const originalVercel = process.env.VERCEL_URL;

  afterEach(() => {
    if (originalSite === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = originalSite;
    }
    if (originalVercel === undefined) {
      delete process.env.VERCEL_URL;
    } else {
      process.env.VERCEL_URL = originalVercel;
    }
  });

  it('uses NEXT_PUBLIC_SITE_URL origin when set', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://www.ovld.ai/';
    delete process.env.VERCEL_URL;

    expect(getSiteMetadataBaseUrl()).toBe('https://www.ovld.ai');
  });

  it('falls back to https VERCEL_URL host when site URL is unset', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL_URL = 'preview-abc.vercel.app';

    expect(getSiteMetadataBaseUrl()).toBe('https://preview-abc.vercel.app');
  });

  it('falls back to localhost when no deploy hints are set', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;

    expect(getSiteMetadataBaseUrl()).toBe('http://localhost:3000');
  });
});
