'use client';

import { useState } from 'react';

import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { saveEverhourApiKey } from '@/lib/actions/everhour';

type EverhourSettingsProps = {
  initiallyConnected: boolean;
  lastUpdatedAt: string | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Failed to save Everhour API key.';
}

export function EverhourSettings({ initiallyConnected, lastUpdatedAt }: EverhourSettingsProps) {
  const [apiKey, setApiKey] = useState('');
  const [connected, setConnected] = useState(initiallyConnected);
  const [savedAt, setSavedAt] = useState<string | null>(lastUpdatedAt);
  const [saveButtonState, setSaveButtonState] = useState<ButtonLoadingState>('default');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSave() {
    if (!apiKey.trim()) {
      setSaveButtonState('error');
      setErrorMessage('Enter your Everhour API key.');
      return;
    }

    setSaveButtonState('loading');
    setErrorMessage(null);

    try {
      await saveEverhourApiKey(apiKey);
      const now = new Date().toISOString();
      setConnected(true);
      setSavedAt(now);
      setApiKey('');
      setSaveButtonState('success');
    } catch (error) {
      setSaveButtonState('error');
      setErrorMessage(getErrorMessage(error));
    }
  }

  return (
    <section className="max-w-2xl space-y-3 rounded-lg border bg-card p-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Everhour</h2>
        <p className="text-muted-foreground text-sm">
          Add your personal Everhour API token to enable timers and time entries on tickets.
        </p>
        <p className="text-muted-foreground text-xs">
          Project mapping is managed per organization from the ticket Project section via{' '}
          <span className="font-medium">Sync Projects to Everhour</span>.
        </p>
      </div>

      <p className="text-muted-foreground text-xs">
        Get your token in Everhour:{' '}
        <span className="font-medium">Settings → My Profile → API Token</span>
      </p>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-md"
          onChange={event => setApiKey(event.target.value)}
          placeholder="Paste Everhour API key"
          type="password"
          value={apiKey}
        />
        <LoadingButton
          buttonState={saveButtonState}
          setButtonState={setSaveButtonState}
          text="Save Key"
          loadingText="Saving…"
          successText="Saved"
          errorText="Retry"
          reset
          onClick={handleSave}
        />
      </div>

      <div className="text-xs">
        {connected ? (
          <p className="text-emerald-700">
            Connected
            {savedAt ? ` (last updated ${new Date(savedAt).toLocaleString()})` : null}
          </p>
        ) : (
          <p className="text-muted-foreground">Not connected yet.</p>
        )}
      </div>

      {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
    </section>
  );
}
