'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { setPasswordAction, updatePasswordAction } from '@/lib/actions/account';

type PasswordFormProps = {
  hasPassword: boolean;
};

export function PasswordForm({ hasPassword }: PasswordFormProps) {
  const router = useRouter();
  const [hasSavedPassword, setHasSavedPassword] = useState(hasPassword);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setHasSavedPassword(hasPassword);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setButtonState('default');
    setErrorMessage(null);
  }, [hasPassword]);

  const handleSubmit = async () => {
    setErrorMessage(null);

    if (newPassword !== confirmPassword) {
      setErrorMessage('New passwords do not match.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters.');
      return;
    }

    setButtonState('loading');

    try {
      if (hasSavedPassword) {
        await updatePasswordAction(currentPassword, newPassword);
      } else {
        await setPasswordAction(newPassword);
      }
      setHasSavedPassword(true);
      setButtonState('success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update password.');
      setButtonState('error');
    }
  };

  const isValid =
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    (!hasSavedPassword || currentPassword.length > 0);

  return (
    <div className="space-y-3">
      {hasSavedPassword && (
        <div className="space-y-1.5">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            placeholder="Enter current password"
            className="max-w-sm"
            autoComplete="current-password"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="new-password">{hasSavedPassword ? 'New password' : 'Password'}</Label>
        <Input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          placeholder="At least 8 characters"
          className="max-w-sm"
          autoComplete="new-password"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          placeholder="Confirm password"
          className="max-w-sm"
          autoComplete="new-password"
        />
      </div>
      {errorMessage && <p className="text-destructive text-sm">{errorMessage}</p>}
      <LoadingButton
        buttonState={buttonState}
        setButtonState={setButtonState}
        text={hasSavedPassword ? 'Update password' : 'Set password'}
        loadingText="Saving..."
        successText="Password updated"
        errorText="Retry"
        onClick={handleSubmit}
        disabled={!isValid}
      />
    </div>
  );
}
