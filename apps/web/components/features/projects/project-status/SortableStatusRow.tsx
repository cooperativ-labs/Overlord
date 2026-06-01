'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, Pencil, Star, Trash2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { type StatusRow, statusTypeOptions } from './project-status-helpers';

type SortableStatusRowProps = {
  status: StatusRow;
  isDefault: boolean;
  editingStatusName: string | null;
  editingNameValue: string;
  hasPendingMutation: boolean;
  onSetDefault: (name: string) => Promise<void>;
  onDeleteStatus: (name: string) => Promise<void>;
  onStartRename: (name: string) => void;
  onSaveRename: (currentName: string) => Promise<void>;
  onCancelRename: () => void;
  setEditingNameValue: React.Dispatch<React.SetStateAction<string>>;
};

export function SortableStatusRow({
  status,
  isDefault,
  editingStatusName,
  editingNameValue,
  hasPendingMutation,
  onSetDefault,
  onDeleteStatus,
  onStartRename,
  onSaveRename,
  onCancelRename,
  setEditingNameValue
}: SortableStatusRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: status.name,
    disabled: hasPendingMutation || editingStatusName !== null
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-sm',
        isDragging ? 'bg-muted/60 opacity-70' : ''
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 cursor-grab active:cursor-grabbing"
        disabled={hasPendingMutation || editingStatusName !== null}
        aria-label={`Drag to reorder ${status.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </Button>

      {editingStatusName === status.name ? (
        <Input
          value={editingNameValue}
          onChange={event => setEditingNameValue(event.target.value)}
          className="h-7 w-[170px]"
          disabled={hasPendingMutation}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              void onSaveRename(status.name);
            }
            if (event.key === 'Escape') {
              onCancelRename();
            }
          }}
          aria-label={`Edit ${status.name} name`}
        />
      ) : (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{status.name}</code>
      )}

      <Badge variant="outline" className="rounded-full text-[11px]">
        Type: {statusTypeOptions.find(option => option.value === status.statusType)?.label}
      </Badge>

      {isDefault ? (
        <Badge variant="secondary" className="gap-1 rounded-full text-[11px]">
          <Star className="h-2.5 w-2.5 fill-current" />
          Default
        </Badge>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-muted-foreground"
          onClick={() => onSetDefault(status.name)}
          disabled={hasPendingMutation || editingStatusName !== null}
          aria-label={`Set ${status.name} as default status for new tickets`}
        >
          Set default
        </Button>
      )}

      {editingStatusName === status.name ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onSaveRename(status.name)}
            disabled={hasPendingMutation || editingNameValue.trim().length === 0}
            aria-label={`Save ${status.name} name`}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onCancelRename}
            disabled={hasPendingMutation}
            aria-label={`Cancel editing ${status.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onStartRename(status.name)}
          disabled={hasPendingMutation}
          aria-label={`Rename ${status.name}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-destructive hover:text-destructive"
        onClick={() => onDeleteStatus(status.name)}
        disabled={hasPendingMutation || editingStatusName !== null}
        aria-label={`Delete ${status.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
