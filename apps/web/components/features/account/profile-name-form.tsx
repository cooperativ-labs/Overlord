'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { updateProfileNameAction } from '@/lib/actions/account';

type ProfileNameFormProps = {
  initialName: string;
};

export function ProfileNameForm({ initialName }: ProfileNameFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setName(initialName);
    setSavedName(initialName);
    setButtonState('default');
    setErrorMessage(null);
  }, [initialName]);

  const handleSave = async () => {
    const trimmed = name.trim();

    setButtonState('loading');
    setErrorMessage(null);

    try {
      await updateProfileNameAction(trimmed);
      setName(trimmed);
      setSavedName(trimmed);
      setButtonState('success');
      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update name.');
      setButtonState('error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="display-name">Display name</Label>
        <Input
          id="display-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          className="max-w-sm"
        />
      </div>
      {errorMessage && <p className="text-destructive text-sm">{errorMessage}</p>}
      <LoadingButton
        buttonState={buttonState}
        setButtonState={setButtonState}
        text="Save name"
        loadingText="Saving..."
        successText="Saved"
        errorText="Retry"
        onClick={handleSave}
        disabled={!name.trim() || name.trim() === savedName}
      />
    </div>
  );
}
