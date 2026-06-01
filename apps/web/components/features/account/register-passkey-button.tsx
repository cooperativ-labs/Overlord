'use client';

import { Fingerprint } from 'lucide-react';
import { useState } from 'react';

import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { createClient } from '@/supabase/utils/client';

type RegisterPasskeyButtonProps = {
  onRegistered?: () => void | Promise<void>;
};

export function RegisterPasskeyButton({ onRegistered }: RegisterPasskeyButtonProps) {
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleRegister = async () => {
    setButtonState('loading');
    setErrorMessage(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.registerPasskey();

      if (error) {
        setErrorMessage(error.message ?? 'Failed to register passkey.');
        setButtonState('error');
        return;
      }

      setButtonState('success');
      await onRegistered?.();
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setErrorMessage('Passkey registration was cancelled.');
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to register passkey.');
      }
      setButtonState('error');
    }
  };

  return (
    <div className="space-y-2">
      <LoadingButton
        type="button"
        variant="outline"
        buttonState={buttonState}
        setButtonState={setButtonState}
        onClick={() => void handleRegister()}
        text={
          <span className="flex items-center justify-center gap-2">
            <Fingerprint className="size-4" />
            Add passkey
          </span>
        }
        loadingText="Waiting for device..."
        successText="Passkey registered"
        errorText="Registration failed"
      />
      {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
    </div>
  );
}
