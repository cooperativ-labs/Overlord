'use client';

import { useState } from 'react';

import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';

import { approveAuthorization, denyAuthorization } from './actions';

export function OAuthActions({ authorizationId }: { authorizationId: string }) {
  const [approveButtonState, setApproveButtonState] = useState<ButtonLoadingState>('default');
  const [denyButtonState, setDenyButtonState] = useState<ButtonLoadingState>('default');

  const handleApprove = async () => {
    setApproveButtonState('loading');
    try {
      await approveAuthorization(authorizationId);
      setApproveButtonState('success');
    } catch (error) {
      setApproveButtonState('error');
      console.error('Failed to approve authorization:', error);
    }
  };

  const handleDeny = async () => {
    setDenyButtonState('loading');
    try {
      await denyAuthorization(authorizationId);
      setDenyButtonState('success');
    } catch (error) {
      setDenyButtonState('error');
      console.error('Failed to deny authorization:', error);
    }
  };

  return (
    <div className="flex gap-3">
      <LoadingButton
        buttonState={denyButtonState}
        setButtonState={setDenyButtonState}
        text="Deny"
        loadingText="Denying..."
        onClick={handleDeny}
        variant="outline"
        className="flex-1"
      />
      <LoadingButton
        buttonState={approveButtonState}
        setButtonState={setApproveButtonState}
        text="Approve"
        loadingText="Approving..."
        successText="Approved!"
        onClick={handleApprove}
        className="flex-1"
      />
    </div>
  );
}
