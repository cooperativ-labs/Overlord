'use client';

import { GitCommit, Loader2, Sparkles, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useElectron } from '@/components/features/terminal/useElectron';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
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
  const [generateButtonState, setGenerateButtonState] = useState<ButtonLoadingState>('default');
  const [pushButtonState, setPushButtonState] = useState<ButtonLoadingState>('default');

  const disabled = !hasChanges || !api?.filesystem;
  const isGenerating = generateButtonState === 'loading';
  const isPushing = pushButtonState === 'loading';

  async function handleGenerate() {
    if (!api?.filesystem?.getAggregateDiff) {
      toast.error('Commit message generation requires the desktop app.');
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
      if (!aggregate.diff?.trim()) {
        toast.error('No diff found to summarize.');
        setGenerateButtonState('error');
        return;
      }
      const result = await generateCommitMessageAction({
        branch: aggregate.branch,
        diff: aggregate.diff,
        status: aggregate.status
      });
      if ('error' in result) {
        toast.error(result.error);
        setGenerateButtonState('error');
        return;
      }
      setMessage(result.message);
      setGenerateButtonState('success');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate commit message.');
      setGenerateButtonState('error');
    }
  }

  async function handlePush() {
    if (!api?.filesystem?.gitCommitAndPush) {
      toast.error('Push requires the desktop app.');
      setPushButtonState('error');
      return;
    }
    if (!message.trim()) {
      toast.error('Enter a commit message first.');
      setPushButtonState('error');
      return;
    }
    setPushButtonState('loading');
    try {
      const result = await api.filesystem.gitCommitAndPush({
        directory: workingDirectory,
        message: message.trim()
      });
      if (!result.ok || result.error) {
        toast.error(result.error ?? 'Push failed.');
        setPushButtonState('error');
        return;
      }
      toast.success(
        result.commitSha
          ? `Pushed ${result.commitSha.slice(0, 7)} to ${result.branch ?? 'origin'}.`
          : 'Pushed to GitHub.'
      );
      setMessage('');
      onPushed?.();
      setPushButtonState('success');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to push to GitHub.');
      setPushButtonState('error');
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
        <LoadingButton
          aria-label="Generate commit message with AI"
          buttonState={generateButtonState}
          className={cn(
            'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md p-0 text-muted-foreground transition-colors',
            'hover:bg-muted hover:text-primary'
          )}
          onClick={handleGenerate}
          reset
          setButtonState={setGenerateButtonState}
          size="icon"
          disabled={disabled || isGenerating || isPushing}
          text={<Sparkles className="h-4 w-4" />}
          loadingText={<Loader2 className="h-4 w-4 animate-spin" />}
          successText={<Sparkles className="h-4 w-4 text-emerald-600" />}
          errorText={<Sparkles className="h-4 w-4 text-destructive" />}
          title="Generate commit message with AI"
          variant="ghost"
        />
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <LoadingButton
          buttonState={pushButtonState}
          className="h-8"
          onClick={handlePush}
          reset
          setButtonState={setPushButtonState}
          size="sm"
          disabled={disabled || isPushing || isGenerating || !message.trim()}
          text={
            <>
              <Upload className="h-4 w-4" />
              Commit &amp; push
            </>
          }
          loadingText={
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Pushing…
            </>
          }
          successText="Pushed"
          errorText="Push failed"
        ></LoadingButton>
      </div>
    </div>
  );
}
