import { buildChangelogSitemapPaths } from '@/lib/marketing/changelog-sitemap';

describe('buildChangelogSitemapPaths', () => {
  it('includes the changelog index and one path per published slug', () => {
    expect(buildChangelogSitemapPaths({ slugs: ['release-1-0', 'beta-launch'] })).toEqual([
      '/changelog',
      '/changelog/release-1-0',
      '/changelog/beta-launch'
    ]);
  });

  it('includes only the index when there are no published slugs', () => {
    expect(buildChangelogSitemapPaths({ slugs: [] })).toEqual(['/changelog']);
  });
});
