'use client';

import { useEffect, useState } from 'react';

import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  getProjectSlackDefaultStatusAction,
  updateProjectSlackDefaultStatusAction
} from '@/lib/actions/slack';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const getProjectSlackDefaultStatusActionWithRetry = withElectronActionRetry(
  getProjectSlackDefaultStatusAction
);
const updateProjectSlackDefaultStatusActionWithRetry = withElectronActionRetry(
  updateProjectSlackDefaultStatusAction
);

type ProjectSlackSettingsProps = {
  projectId: string;
  open: boolean;
};

export function ProjectSlackSettings({ projectId, open }: ProjectSlackSettingsProps) {
  const [defaultStatus, setDefaultStatus] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<ButtonLoadingState>('default');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    getProjectSlackDefaultStatusActionWithRetry(projectId)
      .then(status => setDefaultStatus(status ?? ''))
      .finally(() => setLoaded(true));
  }, [open, projectId]);

  async function handleSave() {
    setSaveState('loading');
    setMessage(null);
    const result = await updateProjectSlackDefaultStatusActionWithRetry(
      projectId,
      defaultStatus.trim() || null
    );
    if (result.error) {
      setSaveState('error');
      setMessage(result.error);
    } else {
      setSaveState('success');
    }
    setTimeout(() => setSaveState('default'), 2000);
  }

  if (!loaded) return <p className="text-xs text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">Slack</label>
      <p className="text-xs text-muted-foreground">
        Override the default status for tickets created from Slack in this project. Leave blank to
        use the workspace default.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-8 rounded border bg-background px-2 text-sm"
          value={defaultStatus}
          onChange={e => setDefaultStatus(e.target.value)}
          placeholder="e.g. next-up"
        />
        <LoadingButton
          buttonState={saveState}
          setButtonState={setSaveState}
          text="Save"
          loadingText="Saving…"
          successText="Saved"
          errorText="Retry"
          size="sm"
          variant="outline"
          onClick={handleSave}
        />
      </div>
      {message ? <p className="text-xs text-destructive">{message}</p> : null}
    </div>
  );
}
