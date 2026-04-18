'use client';

import { GitCommit, Loader2, Sparkles, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { generateCommitMessageAction } from '@/lib/actions/generate-commit-message';
import { cn } from '@/lib/utils';

type PushToGithubPanelProps = {
  branch: string | null;
  hasChanges: boolean;
  workingDirectory: string;
  onPushed?: () => void;
};

export function PushToGithubPanel({
  branch,
  hasChanges,
  workingDirectory,
  onPushed
}: PushToGithubPanelProps) {
  const { api } = useElectron();
  const [message, setMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPushing, setIsPushing] = useState(false);

  const disabled = !hasChanges || !api?.filesystem;

  async function handleGenerate() {
    if (!api?.filesystem?.getAggregateDiff) {
      toast.error('Commit message generation requires the desktop app.');
      return;
    }
    setIsGenerating(true);
    try {
      const aggregate = await api.filesystem.getAggregateDiff({ directory: workingDirectory });
      if (aggregate.error) {
        toast.error(aggregate.error);
        return;
      }
      if (!aggregate.diff?.trim()) {
        toast.error('No diff found to summarize.');
        return;
      }
      const result = await generateCommitMessageAction({
        branch: aggregate.branch,
        diff: aggregate.diff,
        status: aggregate.status
      });
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      setMessage(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate commit message.');
    } finally {
      setIsGenerating(false);
    }
  }

  async function handlePush() {
    if (!api?.filesystem?.gitCommitAndPush) {
      toast.error('Push requires the desktop app.');
      return;
    }
    if (!message.trim()) {
      toast.error('Enter a commit message first.');
      return;
    }
    setIsPushing(true);
    try {
      const result = await api.filesystem.gitCommitAndPush({
        directory: workingDirectory,
        message: message.trim()
      });
      if (!result.ok || result.error) {
        toast.error(result.error ?? 'Push failed.');
        return;
      }
      toast.success(
        result.commitSha
          ? `Pushed ${result.commitSha.slice(0, 7)} to ${result.branch ?? 'origin'}.`
          : 'Pushed to GitHub.'
      );
      setMessage('');
      onPushed?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to push to GitHub.');
    } finally {
      setIsPushing(false);
    }
  }

  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <GitCommit className="h-4 w-4 text-primary" />
          <span>Commit &amp; push to GitHub</span>
        </div>
        {branch ? <span className="text-xs text-muted-foreground">branch: {branch}</span> : null}
      </div>

      <div className="relative">
        <Textarea
          value={message}
          onChange={event => setMessage(event.target.value)}
          placeholder={
            hasChanges
              ? 'Write a commit message, or tap the sparkle icon to generate one.'
              : 'No uncommitted changes.'
          }
          rows={3}
          disabled={disabled}
          className="pr-10"
        />
        <button
          type="button"
          aria-label="Generate commit message with AI"
          title="Generate commit message with AI"
          onClick={handleGenerate}
          disabled={disabled || isGenerating || isPushing}
          className={cn(
            'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
            'hover:bg-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
        </button>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handlePush}
          disabled={disabled || isPushing || isGenerating || !message.trim()}
        >
          {isPushing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Pushing…
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Commit &amp; push
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
