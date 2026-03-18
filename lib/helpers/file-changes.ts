export type FileChangeEntry = {
  path: string;
  note: string | null;
  label: string | null;
};

function stripListPrefix(line: string): string {
  return line.replace(/^([-*]|\d+\.)\s+/, '');
}

function stripLocationSuffix(path: string): string {
  return path.replace(/#L\d+(?:C\d+)?$/i, '').replace(/:(\d+)(?::\d+)?$/, '');
}

function parseMarkdownLink(line: string): FileChangeEntry | null {
  const markdownLink = line.match(/^\[([^\]]+)\]\(([^)]+)\)(?:\s+[—–-]\s+(.+))?$/);
  if (!markdownLink) return null;

  return {
    label: markdownLink[1].trim() || null,
    path: stripLocationSuffix(markdownLink[2].trim()),
    note: markdownLink[3]?.trim() || null
  };
}

function parseFileChangeLine(line: string): FileChangeEntry | null {
  if (/^\d+\s+files?\s+changed/.test(line)) return null;

  const stripped = stripListPrefix(line.trim());
  if (!stripped) return null;

  const markdownLink = parseMarkdownLink(stripped);
  if (markdownLink) return markdownLink;

  const gitStat = stripped.match(/^(.+?)\s+\|\s+\d+/);
  if (gitStat) {
    return { path: stripLocationSuffix(gitStat[1].trim()), note: null, label: null };
  }

  const emDash = stripped.match(/^(.+?)\s+[—–]\s+(.+)$/);
  if (emDash) {
    return {
      path: stripLocationSuffix(emDash[1].trim()),
      note: emDash[2].trim(),
      label: null
    };
  }

  return { path: stripLocationSuffix(stripped), note: null, label: null };
}

export function parseFileChanges(content: string): FileChangeEntry[] {
  return content
    .split('\n')
    .map(line => parseFileChangeLine(line))
    .filter((entry): entry is FileChangeEntry => Boolean(entry));
}

function buildEditorHref(path: string, workspaceRoot: string, editorScheme: string): string {
  const fullPath =
    path.startsWith('/') || !workspaceRoot ? path : `${workspaceRoot.replace(/\/$/, '')}/${path}`;

  if (editorScheme.includes('?')) return `${editorScheme}${fullPath}`;
  return `${editorScheme}/${fullPath}`;
}

export function buildDiffHref(path: string, workspaceRoot: string, editorScheme: string): string {
  const fullPath =
    path.startsWith('/') || !workspaceRoot ? path : `${workspaceRoot.replace(/\/$/, '')}/${path}`;
  const scheme = editorScheme.split('://')[0];

  if ((scheme === 'vscode' || scheme === 'cursor') && fullPath.startsWith('/')) {
    const fileUri = encodeURIComponent(`file://${fullPath}`);
    return `${scheme}://vscode.git/openChange?path=${fileUri}`;
  }

  return buildEditorHref(path, workspaceRoot, editorScheme);
}

export function toAttributionFilePaths(content: string): string[] {
  return parseFileChanges(content)
    .map(entry => entry.path)
    .filter(path => path.includes('/') || path.includes('.'));
}
