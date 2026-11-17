import { Loader2, Save } from 'lucide-react';

import { cn } from '../../lib/utils.ts';

type ObjectiveSaveButtonProps = {
  onSave: () => void;
  saving?: boolean;
  disabled?: boolean;
  /** Shown as the native tooltip, e.g. why Save is unavailable. */
  title?: string;
};

/**
 * The Save step of the composer's Save → Run ladder (coo:1289, mirroring the mobile composer):
 * unsaved or empty text shows Save (empty is disabled); once the text is saved the same slot
 * shows the green Run button. Sized and bordered like {@link AgentLaunchButton} so the swap
 * never shifts the toolbar.
 */
export function ObjectiveSaveButton({
  onSave,
  saving = false,
  disabled = false,
  title
}: ObjectiveSaveButtonProps) {
  const inactive = disabled || saving;
  return (
    <button
      type="button"
      data-testid="objective-save-button"
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-3',
        'text-xs font-medium text-foreground shadow-sm transition-colors',
        inactive ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-accent'
      )}
      disabled={inactive}
      title={title}
      onClick={onSave}
    >
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
      <span className="whitespace-nowrap">{saving ? 'Saving…' : 'Save'}</span>
    </button>
  );
}
