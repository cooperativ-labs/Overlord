import { ExternalLink } from '@/components/features/ExternalLink';
import { buildDiffHref, parseFileChanges } from '@/lib/helpers/file-changes';

type Props = {
  content: string;
  workspaceRoot: string;
  editorScheme: string;
};

export function FileChangesArtifact({ content, workspaceRoot, editorScheme }: Props) {
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
      {files.map(({ path, note, label }) => {
        const displayPath =
          path.startsWith('/') && workspaceRoot && path.startsWith(`${workspaceRoot}/`)
            ? path.slice(workspaceRoot.length + 1)
            : path;
        const filename = label ?? displayPath.split('/').pop() ?? displayPath;
        const dir = displayPath.includes('/')
          ? displayPath.slice(0, displayPath.lastIndexOf('/'))
          : '';
        const href = canLink ? buildDiffHref(path, workspaceRoot, editorScheme) : undefined;

        return (
          <li className="text-xs" key={path}>
            {href ? (
              <ExternalLink
                className="inline-flex flex-wrap items-baseline gap-1 rounded hover:underline underline-offset-4 text-primary"
                href={href}
                title={`Open diff for ${path} in editor`}
              >
                <span className="font-medium">{filename}</span>
                {dir && <span className="text-muted-foreground">{dir}</span>}
              </ExternalLink>
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
