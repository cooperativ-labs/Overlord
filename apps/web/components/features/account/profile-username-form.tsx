'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { validateUsername } from '@/lib/account/username';
import { updateUsernameAction } from '@/lib/actions/account';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { refreshElectronRoute } from '@/lib/electron-auth/route-refresh';

const updateUsernameActionWithRetry = withElectronActionRetry(updateUsernameAction);

type ProfileUsernameFormProps = {
  initialUsername: string | null;
};

export function ProfileUsernameForm({ initialUsername }: ProfileUsernameFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState(initialUsername ?? '');
  const [savedUsername, setSavedUsername] = useState(initialUsername ?? '');
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setUsername(initialUsername ?? '');
    setSavedUsername(initialUsername ?? '');
    setButtonState('default');
    setErrorMessage(null);
  }, [initialUsername]);

  const handleSave = async () => {
    const normalized = username.trim().toLowerCase();
    const validation = validateUsername(normalized);
    if (validation.error) {
      setErrorMessage(validation.error);
      setButtonState('error');
      return;
    }

    setButtonState('loading');
    setErrorMessage(null);

    try {
      const result = await updateUsernameActionWithRetry(normalized);
      if (result.error) {
        setErrorMessage(result.error);
        setButtonState('error');
        return;
      }
      setUsername(normalized);
      setSavedUsername(normalized);
      setButtonState('success');
      await refreshElectronRoute(router);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update username.');
      setButtonState('error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="your-handle"
          className="max-w-sm"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <p className="text-muted-foreground text-xs">
          Lowercase letters, numbers, dots, hyphens, and underscores. Others can assign you tickets
          by this handle.
        </p>
      </div>
      {errorMessage && <p className="text-destructive text-sm">{errorMessage}</p>}
      <LoadingButton
        buttonState={buttonState}
        setButtonState={setButtonState}
        text="Save username"
        loadingText="Saving..."
        successText="Saved"
        errorText="Retry"
        onClick={handleSave}
        disabled={!username.trim() || username.trim().toLowerCase() === savedUsername}
      />
    </div>
  );
}
