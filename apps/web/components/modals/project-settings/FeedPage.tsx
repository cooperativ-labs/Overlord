'use client';

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Textarea } from '@/components/ui/textarea';
import {
  getProjectUserPreferencesAction,
  upsertProjectUserPreferencesAction
} from '@/lib/actions/project-user-preferences';
import {
  getProjectProfileDataAction,
  saveOperationsProfileAction
} from '@/lib/actions/repo-profile';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const getProjectUserPreferencesActionWithRetry = withElectronActionRetry(
  getProjectUserPreferencesAction
);
const upsertProjectUserPreferencesActionWithRetry = withElectronActionRetry(
  upsertProjectUserPreferencesAction
);

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
  const { isElectron, api } = useElectron();
  const [feedInstructions, setFeedInstructions] = useState('');
  const [savedFeedInstructions, setSavedFeedInstructions] = useState('');
  const [feedInstructionsLoading, setFeedInstructionsLoading] = useState(false);
  const [feedInstructionsError, setFeedInstructionsError] = useState<string | null>(null);
  const [feedInstructionsSaveState, setFeedInstructionsSaveState] =
    useState<ButtonLoadingState>('default');
  const saveInFlightRef = useRef(false);

  const [profileBuildState, setProfileBuildState] = useState<ButtonLoadingState>('default');
  const [profileJson, setProfileJson] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileMeta, setProfileMeta] = useState<{ rebuilt: boolean; fingerprint: string } | null>(
    null
  );

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
        const preferences = await getProjectUserPreferencesActionWithRetry(projectId);
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
      await upsertProjectUserPreferencesActionWithRetry(projectId, {
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

  async function handleRebuildProfile() {
    if (!isElectron || !api) return;
    setProfileBuildState('loading');
    setProfileError(null);
    try {
      const data = await getProjectProfileDataAction(projectId);
      if (!data.ok) {
        setProfileBuildState('error');
        setProfileError(data.error);
        return;
      }
      if (!data.localDirectory) {
        setProfileBuildState('error');
        setProfileError('No linked working directory for this project.');
        return;
      }

      const result = await api.filesystem.rebuildOperationsProfile({
        directory: data.localDirectory,
        currentFingerprint: data.currentFingerprint
      });
      if (!result.ok) {
        setProfileBuildState('error');
        setProfileError(result.error);
        return;
      }

      const saveResult = await saveOperationsProfileAction(
        projectId,
        result.profile,
        result.fingerprint
      );
      if (!saveResult.ok) {
        setProfileBuildState('error');
        setProfileError(saveResult.error ?? 'Failed to save profile.');
        return;
      }

      setProfileJson(JSON.stringify(result.profile, null, 2));
      setProfileMeta({ rebuilt: result.rebuilt, fingerprint: result.fingerprint });
      setProfileBuildState('success');
    } catch (error) {
      setProfileBuildState('error');
      setProfileError(error instanceof Error ? error.message : 'Failed to build profile.');
    }
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

      <div className="grid gap-2 rounded-md border p-3">
        <div className="grid gap-1">
          <Label>Repo operations profile</Label>
          <p className="text-xs text-muted-foreground">
            A compact deterministic snapshot of this project&apos;s deployable surfaces, migration
            system, codegen steps, tests, and workspace boundaries. The feed generator uses it to
            seed accurate follow-up actions (run migrations, regenerate types, redeploy edge
            functions, etc.) without leaking the raw file tree into the prompt.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LoadingButton
            buttonState={isElectron ? profileBuildState : 'disabled'}
            setButtonState={setProfileBuildState}
            text={profileJson ? 'Rebuild profile' : 'Build profile'}
            loadingText="Building..."
            successText={profileMeta?.rebuilt === false ? 'Up to date' : 'Built'}
            errorText="Retry"
            reset
            size="sm"
            variant="outline"
            onClick={handleRebuildProfile}
          />
          {!isElectron ? (
            <p className="text-xs text-muted-foreground">Requires the Overlord desktop app.</p>
          ) : profileMeta ? (
            <p className="font-mono text-[10px] text-muted-foreground">
              fingerprint: {profileMeta.fingerprint.slice(0, 12)}…
              {profileMeta.rebuilt ? ' (rewrote)' : ' (unchanged)'}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Reads the linked working directory; safe to run anytime.
            </p>
          )}
        </div>
        {profileError ? <p className="text-xs text-destructive">{profileError}</p> : null}
        {profileJson ? (
          <pre className="max-h-80 overflow-auto rounded bg-muted p-2 text-[11px] leading-snug">
            {profileJson}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
