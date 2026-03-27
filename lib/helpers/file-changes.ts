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

function stripTrailingFileAnnotation(path: string): string {
  const trailingAnnotation = path.match(/^(.+\.[^\s()]+)\s+\([^)]+\)$/);
  return trailingAnnotation ? trailingAnnotation[1] : path;
}

function normalizeFilePath(path: string): string {
  return stripTrailingFileAnnotation(stripLocationSuffix(path.trim()));
}

function parseMarkdownLink(line: string): FileChangeEntry | null {
  const markdownLink = line.match(/^\[([^\]]+)\]\(([^)]+)\)(?:\s+[—–-]\s+(.+))?$/);
  if (!markdownLink) return null;

  return {
    label: markdownLink[1].trim() || null,
    path: normalizeFilePath(markdownLink[2]),
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
    return { path: normalizeFilePath(gitStat[1]), note: null, label: null };
  }

  const emDash = stripped.match(/^(.+?)\s+[—–]\s+(.+)$/);
  if (emDash) {
    return {
      path: normalizeFilePath(emDash[1]),
      note: emDash[2].trim(),
      label: null
    };
  }

  // Extract a file-path token from lines that mix a path with descriptive text.
  // Scans tokens left-to-right for the first that looks like a file path
  // (contains '/' and ends with a file extension), then treats the remainder as a note.
  const tokens = stripped.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/\.\w{1,10}$/.test(token) && token.includes('/')) {
      const rest = tokens
        .slice(i + 1)
        .join(' ')
        .trim();
      if (rest) {
        return {
          path: normalizeFilePath(token),
          note: rest,
          label: null
        };
      }
      break; // no trailing text — fall through to default
    }
  }

  return { path: normalizeFilePath(stripped), note: null, label: null };
}

export function parseFileChanges(content: string): FileChangeEntry[] {
  return content
    .split('\n')
    .map(line => parseFileChangeLine(line))
    .filter((entry): entry is FileChangeEntry => Boolean(entry));
}

export function buildEditorHref(path: string, workspaceRoot: string, editorScheme: string): string {
  const fullPath =
    path.startsWith('/') || !workspaceRoot ? path : `${workspaceRoot.replace(/\/$/, '')}/${path}`;

  if (editorScheme.includes('?')) return `${editorScheme}${fullPath}`;
  return `${editorScheme}/${fullPath}`;
}

export function buildDiffHref(path: string, workspaceRoot: string, editorScheme: string): string {
  const fullPath =
    path.startsWith('/') || !workspaceRoot ? path : `${workspaceRoot.replace(/\/$/, '')}/${path}`;
  const scheme = editorScheme.split('://')[0];

  if ((scheme === 'vscode' || scheme === 'windsurf') && fullPath.startsWith('/')) {
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
