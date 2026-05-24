import { isMarketingRoute } from '@/lib/marketing-routes';

describe('isMarketingRoute', () => {
  it('matches marketing paths', () => {
    expect(isMarketingRoute('/')).toBe(true);
    expect(isMarketingRoute('/about')).toBe(true);
    expect(isMarketingRoute('/changelog')).toBe(true);
    expect(isMarketingRoute('/changelog/2026-01-01')).toBe(true);
    expect(isMarketingRoute('/compare')).toBe(true);
    expect(isMarketingRoute('/demo')).toBe(true);
    expect(isMarketingRoute('/problems/context-switching')).toBe(true);
  });

  it('does not match app or docs paths', () => {
    expect(isMarketingRoute('/docs')).toBe(false);
    expect(isMarketingRoute('/login')).toBe(false);
    expect(isMarketingRoute('/projects')).toBe(false);
    expect(isMarketingRoute('/compare-extra')).toBe(false);
  });
});
