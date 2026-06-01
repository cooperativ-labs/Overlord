import { isPublicRoute } from '@/lib/auth/public-routes';

describe('isPublicRoute', () => {
  it('treats changelog index and entry pages as public', () => {
    expect(isPublicRoute('/changelog')).toBe(true);
    expect(isPublicRoute('/changelog/release-1-0')).toBe(true);
  });

  it('treats the anatomy page as public', () => {
    expect(isPublicRoute('/anatomy')).toBe(true);
    expect(isPublicRoute('/anatomy-extra')).toBe(false);
  });

  it('does not treat unrelated paths as public', () => {
    expect(isPublicRoute('/changelogging')).toBe(false);
  });

  it('treats the unsubscribe page as public', () => {
    expect(isPublicRoute('/unsubscribe')).toBe(true);
    expect(isPublicRoute('/unsubscribed')).toBe(false);
  });

  it('treats downloads as public without exposing similarly named paths', () => {
    expect(isPublicRoute('/downloads')).toBe(true);
    expect(isPublicRoute('/downloads/desktop')).toBe(true);
    expect(isPublicRoute('/downloaded')).toBe(false);
  });
});
