import { cn } from '@/lib/utils';

export function ObjectivesExecutedBadge({
  count,
  hasDraftObjectiveWithText = false,
  className
}: {
  count?: number;
  hasDraftObjectiveWithText?: boolean;
  className?: string;
}) {
  if (!count || count <= 0) {
    return null;
  }

  return (
    <span
      className={cn(
        'text-[10px] tabular-nums rounded-full px-1.5 py-0.5',
        hasDraftObjectiveWithText ? 'bg-orange-700 text-white' : 'bg-muted text-fg3',
        className
      )}
      title={
        hasDraftObjectiveWithText
          ? `${count} objective${count === 1 ? '' : 's'} executed — draft objective pending`
          : `${count} objective${count === 1 ? '' : 's'} executed`
      }
    >
      {count}×
    </span>
  );
}
