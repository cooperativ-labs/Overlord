'use client';

import { ExternalLink, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  disconnectSlackWorkspaceAction,
  getSlackWorkspacesAction,
  type SlackWorkspace,
  updateSlackWorkspaceAction
} from '@/lib/actions/slack';

function buildAddToSlackUrl(redirectUri: string): string {
  const clientId = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID ?? '';
  const scopes = [
    'app_mentions:read',
    'chat:write',
    'commands',
    'im:history',
    'im:write',
    'links:read',
    'links:write',
    'users:read',
    'channels:history',
    'groups:history'
  ].join(',');
  return `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

type WorkspaceRowProps = {
  workspace: SlackWorkspace;
  onRemove: (id: string) => void;
};

function WorkspaceRow({ workspace, onRemove }: WorkspaceRowProps) {
  const [disconnectState, setDisconnectState] = useState<ButtonLoadingState>('default');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [defaultStatus, setDefaultStatus] = useState(workspace.default_status);
  const [savingStatus, setSavingStatus] = useState<ButtonLoadingState>('default');

  async function handleDisconnect() {
    setDisconnectState('loading');
    const result = await disconnectSlackWorkspaceAction(workspace.id);
    if (result.error) {
      setDisconnectState('error');
      setStatusMsg(result.error);
    } else {
      onRemove(workspace.id);
    }
  }

  async function handleSaveStatus() {
    setSavingStatus('loading');
    const result = await updateSlackWorkspaceAction(workspace.id, {
      default_status: defaultStatus
    });
    if (result.error) {
      setSavingStatus('error');
      setStatusMsg(result.error);
    } else {
      setSavingStatus('success');
    }
    setTimeout(() => setSavingStatus('default'), 2000);
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{workspace.team_name}</span>
          <span className="text-xs text-muted-foreground">({workspace.team_id})</span>
        </div>
        <LoadingButton
          buttonState={disconnectState}
          setButtonState={setDisconnectState}
          text="Disconnect"
          loadingText="Disconnecting…"
          successText="Disconnected"
          errorText="Retry"
          size="sm"
          variant="outline"
          onClick={handleDisconnect}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Default ticket status:</span>
        <input
          className="h-7 rounded border bg-background px-2 text-xs"
          value={defaultStatus}
          onChange={e => setDefaultStatus(e.target.value)}
          placeholder="next-up"
        />
        <LoadingButton
          buttonState={savingStatus}
          setButtonState={setSavingStatus}
          text="Save"
          loadingText="Saving…"
          successText="Saved"
          errorText="Retry"
          size="sm"
          variant="outline"
          onClick={handleSaveStatus}
        />
      </div>

      {statusMsg ? <p className="mt-2 text-xs text-destructive">{statusMsg}</p> : null}
    </div>
  );
}

type SlackSettingsProps = {
  open: boolean;
};

export function SlackSettings({ open }: SlackSettingsProps) {
  const [workspaces, setWorkspaces] = useState<SlackWorkspace[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [redirectUri, setRedirectUri] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    getSlackWorkspacesAction()
      .then(ws => setWorkspaces(ws))
      .finally(() => setLoaded(true));
    if (typeof window !== 'undefined') {
      setRedirectUri(`${window.location.origin}/api/integrations/slack/oauth/callback`);
    }
  }, [open]);

  function handleRemove(id: string) {
    setWorkspaces(prev => prev.filter(w => w.id !== id));
  }

  const addToSlackUrl = redirectUri ? buildAddToSlackUrl(redirectUri) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Slack</p>
          <p className="text-xs text-muted-foreground">
            Capture tickets from any Slack workspace by mentioning{' '}
            <code className="rounded bg-muted px-1">@overlord</code>, sending a DM to the bot, or
            using the <code className="rounded bg-muted px-1">/overlord</code> slash command.
          </p>
        </div>
        {addToSlackUrl ? (
          <a
            href={addToSlackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <ExternalLink className="h-3 w-3" />
            Add to Slack
          </a>
        ) : null}
      </div>

      {loaded ? (
        workspaces.length === 0 ? (
          <p className="text-xs text-muted-foreground">No Slack workspaces connected yet.</p>
        ) : (
          <div className="space-y-2">
            {workspaces.map(ws => (
              <WorkspaceRow key={ws.id} workspace={ws} onRemove={handleRemove} />
            ))}
          </div>
        )
      ) : (
        <p className="text-xs text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}
