const FILE_MENTION_REGEX = /(^|[\s(])@([A-Za-z0-9._/\\()[\]-]+)/g;

export function isFileMentionPath(value: string): boolean {
  return value.includes('/') || value.includes('\\') || value.includes('.');
}

export function getCollapsedFileMentionLabel(filePath: string): string {
  const trimmedPath = filePath.trim();
  if (!trimmedPath) return '';

  const normalizedPath = trimmedPath.replace(/\\/g, '/');
  const filename = normalizedPath.split('/').filter(Boolean).pop() ?? trimmedPath;
  return filename || trimmedPath;
}

export function collapseInlineFileMentions(value: string): string {
  return value.replace(FILE_MENTION_REGEX, (match, prefix: string, filePath: string) => {
    if (!isFileMentionPath(filePath)) return match;
    return `${prefix}@${getCollapsedFileMentionLabel(filePath)}`;
  });
}

export function convertInlineFileMentionsToMarkdown(value: string): string {
  return value.replace(FILE_MENTION_REGEX, (match, prefix: string, filePath: string) => {
    if (!isFileMentionPath(filePath)) return match;
    return `${prefix}[@${filePath}](mention:${encodeURIComponent(filePath)})`;
  });
}

export type FileMentionMatch = {
  fullMatch: string;
  filePath: string;
  start: number;
  end: number;
};

export function getFileMentionMatches(value: string): FileMentionMatch[] {
  const matches: FileMentionMatch[] = [];

  for (const match of value.matchAll(FILE_MENTION_REGEX)) {
    const prefix = match[1] ?? '';
    const filePath = match[2] ?? '';
    if (!isFileMentionPath(filePath)) continue;

    const absoluteMatchStart = match.index ?? 0;
    const mentionStart = absoluteMatchStart + prefix.length;

    matches.push({
      fullMatch: `@${filePath}`,
      filePath,
      start: mentionStart,
      end: mentionStart + 1 + filePath.length
    });
  }

  return matches;
}

export function findFileMentionAtCursor(
  value: string,
  cursorPosition: number
): FileMentionMatch | null {
  const clampedCursor = Math.max(0, Math.min(cursorPosition, value.length));

  for (const match of getFileMentionMatches(value)) {
    const mentionStart = match.start;
    const mentionEnd = match.end;
    if (clampedCursor < mentionStart + 1 || clampedCursor > mentionEnd) continue;

    return match;
  }

  return null;
}
