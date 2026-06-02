'use client';

import { Check, Folder, FolderOpen, Pencil, Star, StarOff, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TruncatedPath } from '@/components/ui/truncated-path';
import type { ProjectDeviceResource } from '@/lib/actions/devices';
import { cn } from '@/lib/utils';

type DeviceResourceRowProps = {
  resource: ProjectDeviceResource;
  isEditing: boolean;
  editingResourceLabel: string;
  setEditingResourceLabel: (value: string) => void;
  isSaving: boolean;
  canReveal: boolean;
  /** Whether the current user may manage this target's directories/primary. */
  canManage?: boolean;
  onSaveLabel: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onReveal: () => void;
  onSetPrimary: () => void;
  onRemove: () => void;
};

export function DeviceResourceRow({
  resource,
  isEditing,
  editingResourceLabel,
  setEditingResourceLabel,
  isSaving,
  canReveal,
  canManage = true,
  onSaveLabel,
  onCancelEdit,
  onStartEdit,
  onReveal,
  onSetPrimary,
  onRemove
}: DeviceResourceRowProps) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs">
      <Folder className="ml-5 h-3 w-3 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <Input
            value={editingResourceLabel}
            onChange={event => setEditingResourceLabel(event.target.value)}
            placeholder="Label (optional)"
            className="h-7 text-xs"
            disabled={isSaving}
            autoFocus
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSaveLabel();
              }
              if (event.key === 'Escape') {
                onCancelEdit();
              }
            }}
          />
        ) : (
          <div className="min-w-0 max-w-[500px]">
            {resource.label ? <span className="font-medium">{resource.label}</span> : null}
            <TruncatedPath
              path={resource.directoryPath}
              className={cn(
                'font-mono text-[11px]',
                resource.label ? 'text-muted-foreground' : 'text-foreground'
              )}
            />
          </div>
        )}
      </div>
      {isEditing ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onSaveLabel}
            disabled={isSaving}
            title="Save label"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onCancelEdit}
            disabled={isSaving}
            title="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <>
          {canReveal ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground"
              onClick={onReveal}
              title="See in Finder"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground"
              onClick={onStartEdit}
              title={resource.label ? 'Edit label' : 'Add label'}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title={
              resource.isPrimary
                ? 'Primary directory'
                : canManage
                  ? 'Set as primary'
                  : 'Only the target owner or a project editor can change the primary'
            }
            disabled={!canManage}
            onClick={() => (resource.isPrimary || !canManage ? undefined : onSetPrimary())}
          >
            {resource.isPrimary ? (
              <Star className="h-3.5 w-3.5 fill-current text-amber-500" />
            ) : (
              <StarOff className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </Button>
          {canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={onRemove}
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
