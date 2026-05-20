import { createServiceRoleClient } from '@/supabase/utils/service-role';

export function buildChangelogSitemapPaths({ slugs }: { slugs: string[] }): string[] {
  return ['/changelog', ...slugs.map(slug => `/changelog/${slug}`)];
}

export async function getPublishedChangelogSitemapPaths(): Promise<string[]> {
  try {
    const service = createServiceRoleClient();
    const { data, error } = await service
      .from('changelog_entries')
      .select('slug')
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    if (error) {
      console.error('[sitemap] failed to load changelog entries:', error.message);
      return ['/changelog'];
    }

    const slugs = (data ?? []).map(row => row.slug).filter(Boolean);
    return buildChangelogSitemapPaths({ slugs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[sitemap] failed to load changelog entries:', message);
    return ['/changelog'];
  }
}
