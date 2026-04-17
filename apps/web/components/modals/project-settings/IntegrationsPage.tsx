'use client';

import { useEffect, useState } from 'react';

import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { syncEverhourProjectsForOrganization } from '@/lib/actions/everhour';
import { useDisconnectProjectEverhourMutation } from '@/lib/client-data/projects/mutations';

type IntegrationsPageProps = {
  projectId: string;
  organizationId: number;
  initialEverhourProjectId: string | null;
  hasEverhourApiKey: boolean;
};

export function IntegrationsPage({
  projectId,
  organizationId,
  initialEverhourProjectId,
  hasEverhourApiKey
}: IntegrationsPageProps) {
  const disconnectEverhourMutation = useDisconnectProjectEverhourMutation();
  const [savedEverhourProjectId, setSavedEverhourProjectId] = useState(initialEverhourProjectId);
  const [syncButtonState, setSyncButtonState] = useState<ButtonLoadingState>('default');
  const [disconnectButtonState, setDisconnectButtonState] = useState<ButtonLoadingState>('default');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    setSavedEverhourProjectId(initialEverhourProjectId);
  }, [initialEverhourProjectId]);

  async function handleSyncEverhour() {
    setSyncButtonState('loading');
    setSyncMessage(null);
    try {
      const result = await syncEverhourProjectsForOrganization(organizationId);
      const syncedProject = result.projects.find(project => project.id === projectId);
      setSavedEverhourProjectId(syncedProject?.everhour_project_id ?? null);
      setSyncButtonState('success');
      const baseMessage = `Synced ${result.totalLocal} project${result.totalLocal === 1 ? '' : 's'} to Everhour (${result.created} created, ${result.linked} linked, ${result.mapped} mapped).`;
      const failedMessage =
        result.failedProjects.length > 0
          ? ` Could not auto-create: ${result.failedProjects.join(', ')}. Create these in Everhour, then sync again.`
          : '';
      setSyncMessage(`${baseMessage}${failedMessage}`);
    } catch (error) {
      setSyncButtonState('error');
      setSyncMessage(error instanceof Error ? error.message : 'Failed to sync Everhour projects.');
    }
  }

  async function handleDisconnectEverhour() {
    if (!savedEverhourProjectId) return;

    setDisconnectButtonState('loading');
    setSyncMessage(null);
    try {
      await disconnectEverhourMutation.mutateAsync({ projectId });
      setSavedEverhourProjectId(null);
      setDisconnectButtonState('success');
      setSyncMessage('Disconnected this project from Everhour.');
    } catch (error) {
      setDisconnectButtonState('error');
      setSyncMessage(
        error instanceof Error ? error.message : 'Failed to disconnect project from Everhour.'
      );
    }
  }

  if (!hasEverhourApiKey) {
    return (
      <p className="text-sm text-muted-foreground">
        No integrations are configured. Add an Everhour API key in organization settings to enable
        time tracking.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <label className="text-xs font-medium text-muted-foreground">Everhour</label>
      <p className="text-xs text-muted-foreground">
        This project syncs with the identically named project in your Everhour account. Make sure
        only one Everhour project has this exact name.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <LoadingButton
          buttonState={syncButtonState}
          setButtonState={setSyncButtonState}
          text="Sync Everhour"
          loadingText="Syncing…"
          successText="Synced"
          errorText="Retry"
          reset
          size="sm"
          variant="outline"
          onClick={handleSyncEverhour}
        />
        <LoadingButton
          buttonState={disconnectButtonState}
          setButtonState={setDisconnectButtonState}
          text="Disconnect"
          loadingText="Disconnecting…"
          successText="Disconnected"
          errorText="Retry"
          reset
          size="sm"
          variant="outline"
          disabled={!savedEverhourProjectId || syncButtonState === 'loading'}
          onClick={handleDisconnectEverhour}
        />
      </div>
      {syncMessage ? (
        <p className="text-xs text-muted-foreground" title={syncMessage}>
          {syncMessage}
        </p>
      ) : null}
    </div>
  );
}
