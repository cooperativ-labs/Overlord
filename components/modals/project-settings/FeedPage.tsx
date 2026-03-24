'use client';

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Textarea } from '@/components/ui/textarea';
import {
  getProjectUserPreferencesAction,
  upsertProjectUserPreferencesAction
} from '@/lib/actions/project-user-preferences';

type FeedPageProps = {
  open: boolean;
  projectId: string;
};

export function FeedPage({ open, projectId }: FeedPageProps) {
  const [feedInstructions, setFeedInstructions] = useState('');
  const [savedFeedInstructions, setSavedFeedInstructions] = useState('');
  const [feedInstructionsLoading, setFeedInstructionsLoading] = useState(false);
  const [feedInstructionsError, setFeedInstructionsError] = useState<string | null>(null);
  const [feedInstructionsSaveState, setFeedInstructionsSaveState] =
    useState<ButtonLoadingState>('default');
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setFeedInstructionsSaveState('default');
      setFeedInstructionsError(null);
      return;
    }

    let cancelled = false;

    async function loadFeedInstructions() {
      setFeedInstructionsLoading(true);
      setFeedInstructionsError(null);
      try {
        const preferences = await getProjectUserPreferencesAction(projectId);
        if (cancelled) return;
        const instructions = preferences.feed_post_instructions ?? '';
        setFeedInstructions(instructions);
        setSavedFeedInstructions(instructions);
      } catch (error) {
        if (cancelled) return;
        setFeedInstructionsError(
          error instanceof Error ? error.message : 'Failed to load feed settings.'
        );
      } finally {
        if (!cancelled) {
          setFeedInstructionsLoading(false);
        }
      }
    }

    void loadFeedInstructions();

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  async function handleSaveFeedInstructions() {
    if (feedInstructionsLoading || saveInFlightRef.current) return;

    const trimmedInstructions = feedInstructions.trim();
    if (trimmedInstructions === savedFeedInstructions) return;

    saveInFlightRef.current = true;
    setFeedInstructionsSaveState('loading');
    setFeedInstructionsError(null);
    try {
      await upsertProjectUserPreferencesAction(projectId, {
        feed_post_instructions: trimmedInstructions
      });
      setFeedInstructions(trimmedInstructions);
      setSavedFeedInstructions(trimmedInstructions);
      setFeedInstructionsSaveState('success');
    } catch (error) {
      setFeedInstructionsSaveState('error');
      setFeedInstructionsError(
        error instanceof Error ? error.message : 'Failed to save feed settings.'
      );
    } finally {
      saveInFlightRef.current = false;
    }
  }

  function handleBlur() {
    void handleSaveFeedInstructions();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Escape') return;
    event.currentTarget.blur();
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor="project-feed-post-instructions">Feed post instructions</Label>
        <p className="text-xs text-muted-foreground">
          Add project-specific instructions for generated feed posts. These apply to your account
          only for this project.
        </p>
      </div>
      <Textarea
        id="project-feed-post-instructions"
        placeholder="Example: Call out when Electron app changes require a repack before they take effect."
        rows={5}
        value={feedInstructions}
        onChange={event => setFeedInstructions(event.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={feedInstructionsLoading}
      />
      <p className="text-xs text-muted-foreground">
        The feed generator will append these instructions to the prompt it uses when creating
        project feed posts.
      </p>
      {feedInstructionsError ? (
        <p className="text-xs text-destructive">{feedInstructionsError}</p>
      ) : feedInstructionsSaveState === 'success' ? (
        <p className="text-xs text-muted-foreground">Saved</p>
      ) : null}
      <div className="flex items-center gap-2">
        <LoadingButton
          buttonState={feedInstructionsSaveState}
          setButtonState={setFeedInstructionsSaveState}
          text="Save feed settings"
          loadingText="Saving..."
          successText="Saved"
          errorText="Retry"
          reset
          size="sm"
          variant="outline"
          onClick={handleSaveFeedInstructions}
        />
        {feedInstructionsLoading ? (
          <p className="text-xs text-muted-foreground">Loading saved feed settings…</p>
        ) : (
          <p className="text-xs text-muted-foreground">Changes save when this field loses focus.</p>
        )}
      </div>
    </div>
  );
}
