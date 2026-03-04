'use client';

import { useState } from 'react';

import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';

import { approveDevice } from './actions';

export function DeviceApproveForm({ code }: { code: string }) {
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');

  const handleApprove = async () => {
    setButtonState('loading');
    try {
      await approveDevice(code);
      setButtonState('success');
    } catch (error) {
      setButtonState('error');
      console.error('Failed to approve device:', error);
    }
  };

  return (
    <LoadingButton
      buttonState={buttonState}
      setButtonState={setButtonState}
      text="Approve CLI Access"
      loadingText="Approving..."
      successText="Approved!"
      onClick={handleApprove}
      className="w-full"
    />
  );
}
