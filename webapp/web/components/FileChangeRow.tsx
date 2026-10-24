import type { FileChangeDto } from '../../shared/contract.ts';
import { formatTimestamp } from '../lib/format-date.ts';
import { buildEditorFileHref, getEditorSchemeLabel } from '../lib/helpers/editor-scheme.ts';
import {
  fileChangeBasename,
  fileChangeDirname,
  type FileChangeSourceLabel,
  fileChangeSourceLabel
} from '../lib/objective-file-changes.ts';
import { cn } from '../lib/utils.ts';

const SOURCE_TONE: Record<FileChangeSourceLabel, string> = {
  Native: 'text-[var(--color-ink-dim)]',
  Declared: 'text-sky-700 dark:text-sky-300',
  Unknown: 'text-amber-700 dark:text-amber-300'
};

function joinAbsolutePath(rootPath: string, filePath: string): string {
  const trimmedRoot = rootPath.replace(/[\\/]+$/, '');
  const trimmedFile = filePath.replace(/^[\\/]+/, '');
  const separator = trimmedRoot.includes('\\') && !trimmedRoot.includes('/') ? '\\' : '/';
  return `${trimmedRoot}${separator}${trimmedFile}`;
}

/**
 * One compact line of objective path evidence: the derived basename, its
 * directory dimmed after it, and a Native / Declared / Unknown provenance chip.
 * There is deliberately no per-file explanation — the delivery summary explains
 * the work. When the resource root is known the name deep-links into the
 * operator's editor.
 */
export function FileChangeRow({
  fileChange,
  rootPath,
  editorScheme
}: {
  fileChange: FileChangeDto;
  rootPath: string | null;
  editorScheme: string | null;
}) {
  const basename = fileChangeBasename(fileChange.filePath);
  const dirname = fileChangeDirname(fileChange.filePath);
  const source = fileChangeSourceLabel(fileChange.source);
  const editorHref = rootPath
    ? buildEditorFileHref(joinAbsolutePath(rootPath, fileChange.filePath), editorScheme)
    : null;
  const title = `${fileChange.filePath} · last observed ${formatTimestamp(fileChange.observedAt)}`;

  const name = editorHref ? (
    <a
      href={editorHref}
      className="shrink-0 font-medium text-[var(--color-ink)] underline-offset-2 hover:text-sky-600 hover:underline"
      title={`${title} · opens in ${getEditorSchemeLabel(editorScheme)}`}
    >
      {basename}
    </a>
  ) : (
    <span className="shrink-0 font-medium text-[var(--color-ink)]" title={title}>
      {basename}
    </span>
  );

  return (
    <li className="flex min-w-0 items-baseline gap-2 py-0.5 text-xs">
      {name}
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-ink-dim)]">
        {dirname}
      </span>
      <span
        className={cn(
          'shrink-0 text-[10px] font-medium uppercase tracking-wide',
          SOURCE_TONE[source]
        )}
      >
        {source}
      </span>
    </li>
  );
}
