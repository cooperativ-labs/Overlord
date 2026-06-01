import { FileCode2 } from 'lucide-react';

import { ExternalLink } from '@/components/features/ExternalLink';
import { MarkdownIcon } from '@/components/ui/markdown-icon';
import { buildDiffHref, isMarkdownFile, parseFileChanges } from '@/lib/helpers/file-changes';

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
        const isMd = isMarkdownFile(path);
        const Icon = isMd ? MarkdownIcon : FileCode2;

        return (
          <li className="text-xs" key={path}>
            {href ? (
              <ExternalLink
                className="inline-flex flex-wrap items-center gap-1.5 rounded hover:underline underline-offset-4 text-primary"
                href={href}
                title={`Open diff for ${path} in editor`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="font-medium">{filename}</span>
                {dir && <span className="text-muted-foreground">{dir}</span>}
              </ExternalLink>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="font-medium text-foreground">{filename}</span>
                {dir && <span className="text-muted-foreground">{dir}</span>}
              </span>
            )}
            {note && <p className="mt-0.5 pl-5 text-muted-foreground">{note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
