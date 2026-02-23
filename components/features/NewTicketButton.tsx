'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { createBlankTicketAction } from '@/lib/actions/tickets';
import { buildTicketPath } from '@/lib/helpers/ticket-path';

export function NewTicketButton() {
  const router = useRouter();
  const pathname = usePathname();
  const { defaultProject } = useDefaultProject();
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');

  const segments = pathname.split('/').filter(Boolean);
  const primarySegment = segments[0];
  const organizationId =
    primarySegment && /^\d+$/.test(primarySegment) ? Number(primarySegment) : undefined;
  const projectId =
    defaultProject?.id ??
    (segments[1] === 'projects' && typeof segments[2] === 'string' ? segments[2] : undefined);

  async function handleClick() {
    setButtonState('loading');
    try {
      const {
        id,
        organizationId: createdOrganizationId,
        projectId: createdProjectId
      } = await createBlankTicketAction(organizationId, projectId);
      setButtonState('success');
      router.push(
        `${buildTicketPath({
          organizationId: createdOrganizationId,
          projectId: createdProjectId,
          ticketId: id
        })}?new=1`
      );
    } catch {
      setButtonState('error');
    }
  }

  return (
    <LoadingButton
      buttonState={buttonState}
      setButtonState={setButtonState}
      size="sm"
      text="New Ticket"
      loadingText="Creating…"
      successText="Opening…"
      errorText="Failed"
      onClick={handleClick}
    />
  );
}
