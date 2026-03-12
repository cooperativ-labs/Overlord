type FileLine = {
  path: string;
  note: string | null;
};

function parseFileChanges(content: string): FileLine[] {
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .flatMap<FileLine>(line => {
      // Skip git diff summary: "2 files changed, 35 insertions(+)..."
      if (/^\d+\s+files?\s+changed/.test(line)) return [];

      // Strip leading bullet/list prefix ("- " or "* ")
      const stripped = line.replace(/^[-*]\s+/, '');

      // Git diff --stat format: "path/to/file.ts | 50 ++++---"
      const gitStat = stripped.match(/^(.+?)\s+\|\s+\d+/);
      if (gitStat) return [{ path: gitStat[1].trim(), note: null }];

      // Em/en dash separator: "path/to/file.ts — some note"
      const emDash = stripped.match(/^(.+?)\s+[—–]\s+(.+)$/);
      if (emDash) return [{ path: emDash[1].trim(), note: emDash[2].trim() }];

      return [{ path: stripped, note: null }];
    });
}

function buildEditorHref(path: string, workspaceRoot: string, editorScheme: string): string {
  const fullPath = workspaceRoot ? `${workspaceRoot.replace(/\/$/, '')}/${path}` : path;
  // JetBrains uses a query-param style: "idea://open?file=PATH"
  if (editorScheme.includes('?')) return `${editorScheme}${fullPath}`;
  return `${editorScheme}/${fullPath}`;
}

type Props = {
  content: string;
  workspaceRoot: string;
  editorScheme: string;
  projectId?: string;
};

export function FileChangesArtifact({ content, workspaceRoot, editorScheme, projectId }: Props) {
  const files = parseFileChanges(content);

  if (!files.length) {
    return (
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border bg-muted p-2 text-xs">
        {content}
      </pre>
    );
  }

  const canLink = Boolean(workspaceRoot);

  return (
    <ul className="mt-1 grid gap-1.5">
      {files.map(({ path, note }) => {
        const filename = path.split('/').pop() ?? path;
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        const currentChangesHref = projectId
          ? `/projects/${projectId}/current-changes?file=${encodeURIComponent(path)}`
          : undefined;
        const editorHref = canLink ? buildEditorHref(path, workspaceRoot, editorScheme) : undefined;
        const href = currentChangesHref ?? editorHref;

        return (
          <li className="text-xs" key={path}>
            {href ? (
              <a
                className="inline-flex flex-wrap items-baseline gap-1 rounded hover:underline underline-offset-4 text-primary"
                href={href}
                title={
                  currentChangesHref ? `View ${path} in Current Changes` : `Open ${path} in editor`
                }
              >
                <span className="font-medium">{filename}</span>
                {dir && <span className="text-muted-foreground">{dir}</span>}
              </a>
            ) : (
              <span className="inline-flex flex-wrap items-baseline gap-1">
                <span className="font-medium text-foreground">{filename}</span>
                {dir && <span className="text-muted-foreground">{dir}</span>}
              </span>
            )}
            {note && <p className="mt-0.5 pl-3 text-muted-foreground">{note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
