/**
 * GitHub-style heading slug for in-page anchors.
 */
export function slugifyHeadingText(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return base || 'section';
}

export function createHeadingSlugRegistry() {
  const counts = new Map<string, number>();

  return function registerHeadingSlug(text: string): string {
    const base = slugifyHeadingText(text);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen}`;
  };
}
