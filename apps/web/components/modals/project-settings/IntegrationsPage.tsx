'use client';

import { useEffect, useState } from 'react';

import { ProjectSlackSettings } from '@/components/features/slack/ProjectSlackSettings';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Separator } from '@/components/ui/separator';
import { syncEverhourProjectsForOrganization } from '@/lib/actions/everhour';
import { updateProjectEverhourProjectNameAction } from '@/lib/actions/projects';
import { useDisconnectProjectEverhourMutation } from '@/lib/client-data/projects/mutations';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const syncEverhourProjectsForOrganizationWithRetry = withElectronActionRetry(
  syncEverhourProjectsForOrganization
);
const updateProjectEverhourProjectNameWithRetry = withElectronActionRetry(
  updateProjectEverhourProjectNameAction
);

type IntegrationsPageProps = {
  projectId: string;
  organizationId: number;
  projectName: string;
  initialEverhourProjectId: string | null;
  initialEverhourProjectName: string | null;
  hasEverhourApiKey: boolean;
  slackEnabled?: boolean;
  open: boolean;
};

export function IntegrationsPage({
  projectId,
  organizationId,
  projectName,
  initialEverhourProjectId,
  initialEverhourProjectName,
  hasEverhourApiKey,
  slackEnabled = false,
  open
}: IntegrationsPageProps) {
  const disconnectEverhourMutation = useDisconnectProjectEverhourMutation();
  const [savedEverhourProjectId, setSavedEverhourProjectId] = useState(initialEverhourProjectId);
  const [everhourProjectName, setEverhourProjectName] = useState(initialEverhourProjectName ?? '');
  const [syncButtonState, setSyncButtonState] = useState<ButtonLoadingState>('default');
  const [disconnectButtonState, setDisconnectButtonState] = useState<ButtonLoadingState>('default');
  const [saveNameButtonState, setSaveNameButtonState] = useState<ButtonLoadingState>('default');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    setSavedEverhourProjectId(initialEverhourProjectId);
  }, [initialEverhourProjectId]);

  useEffect(() => {
    setEverhourProjectName(initialEverhourProjectName ?? '');
  }, [initialEverhourProjectName]);

  async function handleSaveEverhourProjectName() {
    setSaveNameButtonState('loading');
    setSyncMessage(null);
    try {
      await updateProjectEverhourProjectNameWithRetry({
        projectId,
        everhourProjectName: everhourProjectName.trim() || null
      });
      setSaveNameButtonState('success');
    } catch (error) {
      setSaveNameButtonState('error');
      setSyncMessage(
        error instanceof Error ? error.message : 'Failed to save Everhour project name.'
      );
    }
  }

  async function handleSyncEverhour() {
    setSyncButtonState('loading');
    setSyncMessage(null);
    try {
      const result = await syncEverhourProjectsForOrganizationWithRetry(organizationId);
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

  return (
    <div className="space-y-6">
      {slackEnabled ? <ProjectSlackSettings projectId={projectId} open={open} /> : null}

      {hasEverhourApiKey ? (
        <>
          <Separator />
          <div className="grid gap-2">
            <label className="text-xs font-medium text-muted-foreground">Everhour</label>
            <p className="text-xs text-muted-foreground">
              This project syncs with a project in your Everhour account. By default the Everhour
              project must match this project&apos;s name. Set a custom name below to link to a
              differently-named Everhour project.
            </p>
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground" htmlFor="everhour-project-name">
                Everhour project name
              </label>
              <div className="flex gap-2">
                <input
                  id="everhour-project-name"
                  type="text"
                  className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder={projectName}
                  value={everhourProjectName}
                  onChange={e => {
                    setEverhourProjectName(e.target.value);
                    setSaveNameButtonState('default');
                  }}
                />
                <LoadingButton
                  buttonState={saveNameButtonState}
                  setButtonState={setSaveNameButtonState}
                  text="Save"
                  loadingText="Saving…"
                  successText="Saved"
                  errorText="Retry"
                  reset
                  size="sm"
                  variant="outline"
                  onClick={handleSaveEverhourProjectName}
                />
              </div>
            </div>
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
        </>
      ) : null}
    </div>
  );
}
