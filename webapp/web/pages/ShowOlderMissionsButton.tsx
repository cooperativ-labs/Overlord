import { ChevronDown, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Subtle "load more" control shown beneath the missions already loaded in a
 * terminal column (coo:941). Boards open on a rolling window of recently
 * finished missions; this reveals the rest of the archive for the whole board,
 * so it disappears once the expanded scope is loaded.
 */
export function ShowOlderMissionsButton({
  onClick,
  isLoading = false,
  className
}: {
  onClick: () => void;
  isLoading?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLoading}
      className={cn(
        'flex w-full items-center justify-center gap-1 rounded-md py-1.5 text-[11px] text-muted-foreground/50 transition-colors',
        'hover:bg-muted/50 hover:text-muted-foreground disabled:cursor-default disabled:hover:bg-transparent',
        className
      )}
    >
      {isLoading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <ChevronDown className="h-3 w-3" />
      )}
      {isLoading ? 'Loading older missions…' : 'Show older missions'}
    </button>
  );
}
