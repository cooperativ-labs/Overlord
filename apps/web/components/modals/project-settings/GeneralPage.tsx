'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ProjectColorSetter } from '@/components/features/projects/ProjectColorSetter';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { updateProjectColorAction, updateProjectNameAction } from '@/lib/actions/projects';

type GeneralPageProps = {
  open: boolean;
  projectId: string;
  initialName: string;
  initialColor: string;
};

export function GeneralPage({ open, projectId, initialName, initialColor }: GeneralPageProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [savedColor, setSavedColor] = useState(initialColor);
  const [nameSaveState, setNameSaveState] = useState<ButtonLoadingState>('default');
  const [nameError, setNameError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);

  useEffect(() => {
    setSavedColor(initialColor);
  }, [initialColor]);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setSavedName(initialName);
    }
  }, [open, initialName]);

  async function handleSaveName() {
    const trimmed = name.trim();
    if (trimmed === savedName) return;

    setNameSaveState('loading');
    setNameError(null);
    try {
      await updateProjectNameAction({ projectId, name: trimmed });
      setSavedName(trimmed);
      setNameSaveState('success');
      router.refresh();
    } catch (error) {
      setNameSaveState('error');
      setNameError(error instanceof Error ? error.message : 'Failed to update name.');
    }
  }

  async function handleSelectColor(color: string) {
    if (color.toLowerCase() === savedColor.toLowerCase()) return;

    setColorError(null);
    try {
      await updateProjectColorAction({ projectId, color: color.toLowerCase() });
      setSavedColor(color.toLowerCase());
      router.refresh();
    } catch (error) {
      setColorError(error instanceof Error ? error.message : 'Failed to update color.');
    }
  }

  return (
    <>
      <div className="grid gap-2">
        <label className="text-xs font-medium text-muted-foreground">Name</label>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Mobile App"
            className="h-8"
            onBlur={handleSaveName}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSaveName();
            }}
            disabled={nameSaveState === 'loading'}
          />
          <LoadingButton
            buttonState={nameSaveState}
            setButtonState={setNameSaveState}
            text="Save"
            loadingText="Saving…"
            successText="Saved"
            errorText="Retry"
            reset
            size="sm"
            variant="outline"
            className="h-8 shrink-0"
            onClick={handleSaveName}
          />
        </div>
        {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
      </div>

      <div className="grid gap-2">
        <label className="text-xs font-medium text-muted-foreground">Color</label>
        <ProjectColorSetter value={savedColor} onSelect={handleSelectColor} />
        {colorError ? <p className="text-xs text-destructive">{colorError}</p> : null}
      </div>
    </>
  );
}
