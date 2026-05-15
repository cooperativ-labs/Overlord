/** Last path segment (folder name), normalized for `/` and `\`. */
export function labelFromDirectoryPath(directoryPath: string): string | null {
  const trimmed = directoryPath.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (!last || last === '.' || last === '..') return null;

  return last;
}

/** Picks `baseLabel` or `baseLabel-2`, `baseLabel-3`, … until unused. */
export function uniqueDirectoryLabel({
  baseLabel,
  existingLabels
}: {
  baseLabel: string;
  existingLabels: Iterable<string | null | undefined>;
}): string {
  const occupied = new Set<string>();
  for (const label of existingLabels) {
    const trimmed = label?.trim();
    if (trimmed) occupied.add(trimmed);
  }

  if (!occupied.has(baseLabel)) return baseLabel;

  let suffix = 2;
  while (occupied.has(`${baseLabel}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseLabel}-${suffix}`;
}

export function defaultDirectoryLabel({
  directoryPath,
  existingLabels
}: {
  directoryPath: string;
  existingLabels: Iterable<string | null | undefined>;
}): string | null {
  const base = labelFromDirectoryPath(directoryPath);
  if (!base) return null;
  return uniqueDirectoryLabel({ baseLabel: base, existingLabels });
}
