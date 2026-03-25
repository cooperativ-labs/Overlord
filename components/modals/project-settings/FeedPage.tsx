'use client';

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Textarea } from '@/components/ui/textarea';
import {
  getProjectUserPreferencesAction,
  upsertProjectUserPreferencesAction
} from '@/lib/actions/project-user-preferences';

const FEED_POST_PARAMETERS = [
  {
    name: 'title',
    type: 'string',
    description: 'One-line action-oriented summary (max 80 characters)'
  },
  {
    name: 'body',
    type: 'string',
    description: 'Concise Markdown summary using bullet points (max 300 words)'
  },
  {
    name: 'tags',
    type: 'string[]',
    description: 'Labels like bugfix, refactor, new-feature, tradeoff, action-required, etc.'
  },
  {
    name: 'impact_level',
    type: '"minor" | "notable" | "significant"',
    description: 'Severity of the change'
  },
  {
    name: 'tradeoffs',
    type: 'object[]',
    description:
      'Design decisions with decision, alternatives_considered, and rationale fields — surfaced prominently in the feed'
  },
  {
    name: 'human_actions',
    type: 'string[]',
    description:
      'Proactive tasks the human must perform (e.g. set an API key, run a migration, deploy a function) — not testing or review'
  },
  {
    name: 'files_touched',
    type: 'string[]',
    description: 'File paths modified during the session'
  },
  {
    name: 'tickets_created',
    type: 'object[]',
    description: 'Tickets spawned during the session, each with id, sequence, and title'
  }
];

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
      <div className="grid gap-2 rounded-md border p-3">
        <p className="text-xs font-medium">Available output parameters</p>
        <p className="text-xs text-muted-foreground">
          Reference these in your instructions to target specific parts of the generated post.
        </p>
        <div className="grid gap-2">
          {FEED_POST_PARAMETERS.map(param => (
            <div key={param.name} className="grid gap-0.5">
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted px-1 py-0.5 text-xs font-semibold">
                  {param.name}
                </code>
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {param.type}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{param.description}</p>
            </div>
          ))}
        </div>
      </div>
      {feedInstructionsError ? (
        <p className="text-xs text-destructive">{feedInstructionsError}</p>
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
