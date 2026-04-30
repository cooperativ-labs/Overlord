'use client';

import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { updateOrganizationNameAction } from '@/lib/actions/organizations';

type GeneralPageProps = {
  open: boolean;
  organizationId: number;
  initialName: string;
  onNameChange: (name: string) => void;
};

export function GeneralPage({ open, organizationId, initialName, onNameChange }: GeneralPageProps) {
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [saveState, setSaveState] = useState<ButtonLoadingState>('default');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setSavedName(initialName);
      setSaveState('default');
      setError(null);
    }
  }, [open, initialName]);

  async function handleSave() {
    const trimmed = name.trim();
    if (trimmed === savedName || !trimmed) return;
    setSaveState('loading');
    setError(null);
    try {
      const next = await updateOrganizationNameAction(organizationId, trimmed);
      setSavedName(next);
      setName(next);
      onNameChange(next);
      setSaveState('success');
    } catch (err) {
      setSaveState('error');
      setError(err instanceof Error ? err.message : 'Failed to update name.');
    }
  }

  return (
    <div className="grid gap-2">
      <label className="text-xs font-medium text-muted-foreground">Name</label>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Organization name"
          className="h-8"
          onBlur={handleSave}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave();
          }}
          disabled={saveState === 'loading'}
        />
        <LoadingButton
          buttonState={saveState}
          setButtonState={setSaveState}
          text="Save"
          loadingText="Saving…"
          successText="Saved"
          errorText="Retry"
          reset
          size="sm"
          variant="outline"
          className="h-8 shrink-0"
          onClick={handleSave}
        />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
