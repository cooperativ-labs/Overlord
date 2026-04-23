'use client';

import { ExternalLink, GitPullRequest, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Input } from '@/components/ui/input';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { Textarea } from '@/components/ui/textarea';
import { generatePullRequestDraftAction } from '@/lib/actions/generate-pull-request';

type PullRequestPanelProps = {
  baseBranch: string | null;
  currentBranch: string | null;
  workingDirectory: string;
  onCreated?: () => void;
};

export function PullRequestPanel({
  baseBranch,
  currentBranch,
  workingDirectory,
  onCreated
}: PullRequestPanelProps) {
  const { api } = useElectron();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [generateButtonState, setGenerateButtonState] = useState<ButtonLoadingState>('default');
  const [createButtonState, setCreateButtonState] = useState<ButtonLoadingState>('default');

  async function handleGenerateDraft() {
    if (!api?.filesystem?.getAggregateDiff) {
      toast.error('PR draft generation requires the desktop app.');
      setGenerateButtonState('error');
      return;
    }

    setGenerateButtonState('loading');
    try {
      const aggregate = await api.filesystem.getAggregateDiff({ directory: workingDirectory });
      if (aggregate.error) {
        toast.error(aggregate.error);
        setGenerateButtonState('error');
        return;
      }
      if (!aggregate.diff.trim()) {
        toast.error('No current changes found to summarize into a PR.');
        setGenerateButtonState('error');
        return;
      }

      const result = await generatePullRequestDraftAction({
        baseBranch,
        branch: aggregate.branch,
        diff: aggregate.diff,
        status: aggregate.status
      });

      if ('error' in result) {
        toast.error(result.error);
        setGenerateButtonState('error');
        return;
      }

      setTitle(result.title);
      setBody(result.body);
      setGenerateButtonState('success');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate a PR draft.');
      setGenerateButtonState('error');
    }
  }

  async function handleCreatePullRequest() {
    if (!api?.filesystem?.gitCreatePullRequest) {
      toast.error('PR creation requires the desktop app.');
      setCreateButtonState('error');
      return;
    }
    if (!title.trim() || !body.trim()) {
      toast.error('Generate or enter a PR title and body first.');
      setCreateButtonState('error');
      return;
    }

    setCreateButtonState('loading');
    try {
      const result = await api.filesystem.gitCreatePullRequest({
        directory: workingDirectory,
        options: {
          baseBranch: baseBranch ?? undefined,
          body: body.trim(),
          title: title.trim()
        }
      });

      if (!result.ok || result.error) {
        toast.error(result.error ?? 'Failed to create the pull request.');
        setCreateButtonState('error');
        return;
      }

      if (result.url && api.app?.openExternal) {
        await api.app.openExternal(result.url);
      }

      toast.success(result.url ? `Created PR: ${result.url}` : 'Created the pull request.');
      setCreateButtonState('success');
      onCreated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create the pull request.');
      setCreateButtonState('error');
    }
  }

  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <GitPullRequest className="h-4 w-4 text-primary" />
          <span>Create GitHub pull request</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Draft text uses the current working tree diff. Commit and push before creating the PR so
          GitHub matches the summary.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Head: {currentBranch ?? '(unknown)'}
          {baseBranch ? `  Base: ${baseBranch}` : ''}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex justify-end">
          <LoadingButton
            buttonState={generateButtonState}
            loadingText="Generating..."
            onClick={handleGenerateDraft}
            reset
            setButtonState={setGenerateButtonState}
            size="sm"
            text={
              <>
                <Sparkles className="h-4 w-4" />
                Generate draft
              </>
            }
            variant="outline"
          />
        </div>

        <Input
          placeholder="PR title"
          value={title}
          onChange={event => setTitle(event.target.value)}
        />
        <Textarea
          placeholder="PR description"
          rows={10}
          value={body}
          onChange={event => setBody(event.target.value)}
        />

        <div className="flex justify-end">
          <LoadingButton
            buttonState={createButtonState}
            disabled={!title.trim() || !body.trim()}
            loadingText="Creating..."
            onClick={handleCreatePullRequest}
            reset
            setButtonState={setCreateButtonState}
            size="sm"
            text={
              <>
                <ExternalLink className="h-4 w-4" />
                Create PR
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
