'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { createBlankTicketAction } from '@/lib/actions/tickets';
import { buildProjectPath } from '@/lib/helpers/ticket-path';

export function NewTicketButton() {
  const router = useRouter();
  const pathname = usePathname();
  const { defaultProject } = useDefaultProject();
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');

  const segments = pathname.split('/').filter(Boolean);
  // Route format: /projects/[projectId]/... or /u/...
  const projectId =
    defaultProject?.id ??
    (segments[0] === 'projects' && typeof segments[1] === 'string' ? segments[1] : undefined);

  async function handleClick() {
    setButtonState('loading');
    try {
      const { projectId: createdProjectId } = await createBlankTicketAction(undefined, projectId);
      setButtonState('success');
      router.push(`${buildProjectPath({ projectId: createdProjectId })}?view=board`);
      router.refresh();
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
