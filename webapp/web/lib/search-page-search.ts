/** URL state for the full grouped search page. */
export type SearchPageSearch = { q?: string };

export function parseSearchPageSearch(search: Record<string, unknown>): SearchPageSearch {
  const raw = search.q;
  if (typeof raw !== 'string') return {};
  const q = raw.trim();
  return q ? { q } : {};
}
