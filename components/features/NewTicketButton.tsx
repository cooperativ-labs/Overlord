'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { createBlankTicketAction } from '@/lib/actions/tickets';

export function NewTicketButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');

  const primarySegment = pathname.split('/').filter(Boolean)[0];
  const organizationId =
    primarySegment && /^\d+$/.test(primarySegment) ? Number(primarySegment) : undefined;

  async function handleClick() {
    setButtonState('loading');
    try {
      const { id, organizationId: createdOrganizationId } =
        await createBlankTicketAction(organizationId);
      setButtonState('success');
      router.push(`/${createdOrganizationId}/${id}?new=1`);
    } catch {
      setButtonState('error');
    }
  }

  return (
    <LoadingButton
      buttonState={buttonState}
      setButtonState={setButtonState}
      text="New Ticket"
      loadingText="Creating…"
      successText="Opening…"
      errorText="Failed"
      onClick={handleClick}
    />
  );
}
