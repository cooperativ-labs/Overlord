import { cn } from '@/lib/utils';

type TruncatedPathProps = {
  /** The full file path to display. */
  path: string;
  /** Classes applied to the wrapper (e.g. font + color utilities). */
  className?: string;
};

/**
 * Renders a file path that truncates in the middle when it would overflow its
 * container, keeping the beginning of the path and the final segment visible.
 *
 * Uses a CSS-only flex technique: the head flexes and truncates with an
 * ellipsis, while the trailing segment is pinned and never shrinks. This stays
 * responsive without measuring text, and the full path remains available on
 * hover via the `title` attribute.
 */
export function TruncatedPath({ path, className }: TruncatedPathProps) {
  const lastSeparator = path.lastIndexOf('/');
  const canSplit = lastSeparator > 0 && lastSeparator < path.length - 1;
  const head = canSplit ? path.slice(0, lastSeparator) : path;
  const tail = canSplit ? path.slice(lastSeparator) : '';

  return (
    <span className={cn('flex min-w-0 items-center', className)} title={path}>
      <span className="truncate">{head}</span>
      {tail ? <span className="whitespace-nowrap">{tail}</span> : null}
    </span>
  );
}
