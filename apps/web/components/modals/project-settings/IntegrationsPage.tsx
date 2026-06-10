'use client';

import { useCallback, useEffect, useState } from 'react';

import { ProjectSlackSettings } from '@/components/features/slack/ProjectSlackSettings';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { syncEverhourProjectsForOrganization } from '@/lib/actions/everhour';
import {
  type EverhourLinkedProjectOption,
  getEverhourLinkedProjectsForOrganizationAction,
  linkProjectToExistingEverhourProjectAction,
  updateProjectEverhourProjectNameAction
} from '@/lib/actions/projects';
import { useDisconnectProjectEverhourMutation } from '@/lib/client-data/projects/mutations';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const syncEverhourProjectsForOrganizationWithRetry = withElectronActionRetry(
  syncEverhourProjectsForOrganization
);
const updateProjectEverhourProjectNameWithRetry = withElectronActionRetry(
  updateProjectEverhourProjectNameAction
);
const linkProjectToExistingEverhourProjectWithRetry = withElectronActionRetry(
  linkProjectToExistingEverhourProjectAction
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
  const [linkedOptions, setLinkedOptions] = useState<EverhourLinkedProjectOption[]>([]);
  const [selectedLinkEverhourId, setSelectedLinkEverhourId] = useState('');
  const [linkButtonState, setLinkButtonState] = useState<ButtonLoadingState>('default');

  useEffect(() => {
    setSavedEverhourProjectId(initialEverhourProjectId);
  }, [initialEverhourProjectId]);

  useEffect(() => {
    setEverhourProjectName(initialEverhourProjectName ?? '');
  }, [initialEverhourProjectName]);

  const loadLinkedOptions = useCallback(async () => {
    try {
      const options = await getEverhourLinkedProjectsForOrganizationAction(organizationId);
      setLinkedOptions(options);
    } catch {
      setLinkedOptions([]);
    }
  }, [organizationId]);

  useEffect(() => {
    if (!open || !hasEverhourApiKey) return;
    void loadLinkedOptions();
  }, [open, hasEverhourApiKey, loadLinkedOptions]);

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
      void loadLinkedOptions();
    } catch (error) {
      setSyncButtonState('error');
      setSyncMessage(error instanceof Error ? error.message : 'Failed to sync Everhour projects.');
    }
  }

  async function handleLinkExistingEverhourProject() {
    const option = linkedOptions.find(item => item.everhourProjectId === selectedLinkEverhourId);
    if (!option) {
      setLinkButtonState('error');
      setSyncMessage('Select an Everhour project to link.');
      return;
    }

    setLinkButtonState('loading');
    setSyncMessage(null);
    try {
      await linkProjectToExistingEverhourProjectWithRetry({
        projectId,
        everhourProjectId: option.everhourProjectId
      });
      setSavedEverhourProjectId(option.everhourProjectId);
      setEverhourProjectName(option.everhourProjectName);
      setSelectedLinkEverhourId('');
      setLinkButtonState('success');
      setSyncMessage(
        `Linked this project to the Everhour project "${option.everhourProjectName}".`
      );
      void loadLinkedOptions();
    } catch (error) {
      setLinkButtonState('error');
      setSyncMessage(
        error instanceof Error ? error.message : 'Failed to link to the Everhour project.'
      );
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
      void loadLinkedOptions();
    } catch (error) {
      setDisconnectButtonState('error');
      setSyncMessage(
        error instanceof Error ? error.message : 'Failed to disconnect project from Everhour.'
      );
    }
  }

  const availableLinkOptions = linkedOptions.filter(
    option => option.everhourProjectId !== savedEverhourProjectId
  );

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
            {availableLinkOptions.length > 0 ? (
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground" htmlFor="everhour-shared-project">
                  Share an existing Everhour project
                </label>
                <p className="text-xs text-muted-foreground">
                  Link this project to an Everhour project already used by another Overlord project
                  so they share the same Everhour project and time totals.
                </p>
                <div className="flex gap-2">
                  <Select
                    value={selectedLinkEverhourId}
                    onValueChange={value => {
                      setSelectedLinkEverhourId(value);
                      setLinkButtonState('default');
                    }}
                  >
                    <SelectTrigger id="everhour-shared-project" className="h-8 text-xs">
                      <SelectValue placeholder="Select an Everhour project" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableLinkOptions.map(option => (
                        <SelectItem key={option.everhourProjectId} value={option.everhourProjectId}>
                          {option.everhourProjectName}
                          {option.linkedProjectNames.length > 0
                            ? ` (${option.linkedProjectNames.join(', ')})`
                            : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <LoadingButton
                    buttonState={linkButtonState}
                    setButtonState={setLinkButtonState}
                    text="Link"
                    loadingText="Linking…"
                    successText="Linked"
                    errorText="Retry"
                    reset
                    size="sm"
                    variant="outline"
                    disabled={!selectedLinkEverhourId || linkButtonState === 'loading'}
                    onClick={handleLinkExistingEverhourProject}
                  />
                </div>
              </div>
            ) : null}
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
