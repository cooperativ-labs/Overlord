import { isPublicRoute } from '@/lib/auth/public-routes';

describe('isPublicRoute', () => {
  it('treats changelog index and entry pages as public', () => {
    expect(isPublicRoute('/changelog')).toBe(true);
    expect(isPublicRoute('/changelog/release-1-0')).toBe(true);
  });

  it('does not treat unrelated paths as public', () => {
    expect(isPublicRoute('/changelogging')).toBe(false);
  });

  it('treats the unsubscribe page as public', () => {
    expect(isPublicRoute('/unsubscribe')).toBe(true);
    expect(isPublicRoute('/unsubscribed')).toBe(false);
  });
});
