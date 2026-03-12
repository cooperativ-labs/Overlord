import { cn } from '@/lib/utils';

import { formatStatus, getStatusClasses } from './helpers';
import type { GitStatusFile } from './types';

type FileListItemProps = {
  file: GitStatusFile;
  isSelected: boolean;
  onSelect: () => void;
  rationaleCount: number;
};

export function FileListItem({ file, isSelected, onSelect, rationaleCount }: FileListItemProps) {
  const fileName = file.path.split('/').pop() ?? file.path;
  const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border px-3 py-2 text-left transition',
        isSelected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/60'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{fileName}</p>
          {directory ? <p className="truncate text-xs text-muted-foreground">{directory}</p> : null}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
            getStatusClasses(file.status)
          )}
        >
          {formatStatus(file.status)}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="truncate">
          {file.originalPath ? `${file.originalPath} -> ${file.path}` : file.path}
        </span>
        {rationaleCount > 0 ? <span>{rationaleCount} rationale</span> : null}
      </div>
    </button>
  );
}
