'use client';

import { Check, Pencil, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

type DeviceLabelControlsProps = {
  isEditing: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  isConfirming: boolean;
  isBusy: boolean;
  canSaveLabel: boolean;
  /** device.isAdmin && device.organizationId — whether the remove control is available. */
  showDelete: boolean;
  onSave: () => void;
  onCancel: () => void;
  onStartEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
};

/**
 * The shared rename/save/cancel + remove-from-organization button cluster used by
 * both the in-project and other-devices rows in DeviceResourceList.
 */
export function DeviceLabelControls({
  isEditing,
  isSaving,
  isDeleting,
  isConfirming,
  isBusy,
  canSaveLabel,
  showDelete,
  onSave,
  onCancel,
  onStartEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete
}: DeviceLabelControlsProps) {
  if (isEditing) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onSave}
          disabled={isSaving || !canSaveLabel}
          title="Save"
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onCancel}
          disabled={isSaving}
          title="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-muted-foreground"
        onClick={onStartEdit}
        disabled={isBusy}
        title="Rename device"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>

      {showDelete ? (
        isConfirming ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">Remove?</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
              onClick={onConfirmDelete}
              disabled={isDeleting}
              title="Confirm removal"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onCancelDelete}
              disabled={isDeleting}
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={onRequestDelete}
            disabled={isBusy}
            title="Remove from organization"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )
      ) : null}
    </>
  );
}
