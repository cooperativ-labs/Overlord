import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  useBeginGitHubInstall,
  useDisconnectGitHub,
  useGitHubIntegration,
  useWorkspaces
} from '@/lib/queries';

/**
 * Workspace integrations. Personal accounts (Everhour, your GitHub account,
 * Knowledgebase) are managed on Connected accounts; this page holds only grants
 * that belong to one Overlord workspace.
 */
export function IntegrationsPage({
  onOpenConnectedAccounts
}: {
  onOpenConnectedAccounts?: () => void;
}) {
  const workspaces = useWorkspaces();
  const [githubWorkspaceId, setGitHubWorkspaceId] = useState('');
  const selectedWorkspaceId =
    githubWorkspaceId || (workspaces.data?.length === 1 ? workspaces.data[0]!.id : '');
  const github = useGitHubIntegration(selectedWorkspaceId);
  const beginGitHubInstall = useBeginGitHubInstall(selectedWorkspaceId);
  const disconnectGitHub = useDisconnectGitHub(selectedWorkspaceId);
  const [githubError, setGithubError] = useState<string | null>(null);

  const githubWorkspaceName = github.data?.workspaceName;

  async function handleGitHubInstall() {
    setGithubError(null);
    try {
      const { installUrl } = await beginGitHubInstall.mutateAsync();
      window.location.assign(installUrl);
    } catch (err) {
      setGithubError(
        err instanceof Error ? err.message : 'Failed to start GitHub App installation.'
      );
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-medium">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Your own accounts, including Everhour and your personal GitHub account, are managed on{' '}
          {onOpenConnectedAccounts ? (
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2"
              onClick={onOpenConnectedAccounts}
            >
              Connected accounts
            </button>
          ) : (
            <strong className="text-foreground">Connected accounts</strong>
          )}
          .
        </p>
      </div>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Workspace</h3>
          <p className="text-xs text-muted-foreground">
            Organization-level grants that apply to one Overlord workspace, not to your personal
            login.
          </p>
        </div>

        <div className="max-w-lg space-y-3 rounded-lg border border-border p-4">
          {(workspaces.data?.length ?? 0) > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="github-workspace">Workspace</Label>
              <select
                id="github-workspace"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedWorkspaceId}
                onChange={event => setGitHubWorkspaceId(event.target.value)}
              >
                <option value="">Select a workspace</option>
                {workspaces.data?.map(workspace => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-medium">GitHub App</h4>
              <p className="text-xs text-muted-foreground">
                Workspace installation: link repositories to projects and create pull requests from
                published mission branches.
                {githubWorkspaceName ? (
                  <>
                    {' '}
                    Applies to workspace{' '}
                    <strong className="text-foreground">{githubWorkspaceName}</strong>.
                  </>
                ) : null}
              </p>
            </div>
            {github.data?.connected ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected
              </span>
            ) : null}
          </div>
          {github.data?.connected ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Connected to <strong className="text-foreground">{github.data.accountLogin}</strong>
                {githubWorkspaceName ? (
                  <>
                    {' '}
                    for workspace <strong className="text-foreground">{githubWorkspaceName}</strong>
                  </>
                ) : null}
                .
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!selectedWorkspaceId || disconnectGitHub.isPending}
                onClick={() => void disconnectGitHub.mutateAsync()}
              >
                Disconnect
              </Button>
            </div>
          ) : github.data?.configured ? (
            <Button
              type="button"
              size="sm"
              disabled={!selectedWorkspaceId || beginGitHubInstall.isPending}
              onClick={() => void handleGitHubInstall()}
            >
              Install GitHub App
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              A server administrator must configure GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and
              GITHUB_APP_SLUG before this workspace can install GitHub.
            </p>
          )}
          {githubError ? <p className="text-xs text-destructive">{githubError}</p> : null}
        </div>
      </section>
    </div>
  );
}
