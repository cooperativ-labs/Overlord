'use client';

import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { updateProfileNameAction } from '@/lib/actions/account';

type ProfileNameFormProps = {
  initialName: string;
};

export function ProfileNameForm({ initialName }: ProfileNameFormProps) {
  const [name, setName] = useState(initialName);
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSave = async () => {
    setButtonState('loading');
    setErrorMessage(null);

    try {
      await updateProfileNameAction(name);
      setButtonState('success');
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
        disabled={!name.trim() || name.trim() === initialName}
      />
    </div>
  );
}
