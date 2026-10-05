import type { ChatAssignmentDto, ChatCreatedMissionDto, ChatProposalDto } from '@overlord/contract';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, ClipboardList } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { api } from '@/lib/api.ts';
import { chatErrorCode, chatErrorMessage, isRetryableChatError } from '@/lib/chat/errors.ts';
import { clearRequestId, stableRequestId } from '@/lib/chat/request-ids.ts';
import type { ChatThreadStream } from '@/lib/chat/thread-stream.ts';
import { useMission } from '@/lib/queries/missions.ts';

const SOURCE_LABEL: Record<ChatAssignmentDto['source'], string> = {
  project_default: 'project default',
  user_preference: 'your preference',
  assistant_selection: 'chosen by the assistant'
};

export function assignmentLabel(assignment: ChatAssignmentDto): string {
  return [assignment.agent, assignment.model, assignment.reasoningEffort]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

export type ProposalCardMode = 'creatable' | 'superseded' | 'invalidated' | 'created' | 'cancelled';

/** What the card offers for one proposal block. Only the current, valid, open revision is creatable. */
export function proposalCardMode(
  proposal: ChatProposalDto,
  blockRevision: number
): ProposalCardMode {
  if (proposal.receipt || proposal.state === 'created')
    return blockRevision === (proposal.receipt?.revision ?? proposal.currentRevision)
      ? 'created'
      : 'superseded';
  if (blockRevision < proposal.currentRevision) return 'superseded';
  if (proposal.state === 'cancelled') return 'cancelled';
  if (proposal.current.invalidated) return 'invalidated';
  return 'creatable';
}

/**
 * A versioned draft-work proposal. Every objective shows its frozen agent/model
 * selection and where it came from; Create sends exactly the displayed revision
 * and nothing is created until the person presses it. A retried Create reuses
 * its request id (also across reloads), so a lost response comes back as the
 * original receipt rather than as a second set of drafts.
 */
export function ChatProposalCard({
  proposal,
  blockRevision,
  scope,
  merge,
  onResync
}: {
  proposal: ChatProposalDto;
  blockRevision: number;
  scope: string;
  merge: ChatThreadStream['merge'];
  onResync: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mode = proposalCardMode(proposal, blockRevision);
  const revision = proposal.currentRevision;
  const action = `create:${proposal.id}:${revision}`;

  if (mode === 'superseded') {
    return (
      <p className="text-sm text-(--color-ink-dim)">
        Proposal revision {blockRevision} was replaced by revision{' '}
        {proposal.receipt?.revision ?? proposal.currentRevision}.
      </p>
    );
  }

  const create = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await api.createFromChatProposal(proposal.id, {
        clientRequestId: stableRequestId(scope, action),
        expectedRevision: revision
      });
      clearRequestId(scope, action);
      merge({ proposal: { ...result.proposal, receipt: result.receipt, state: 'created' } });
    } catch (cause) {
      if (!isRetryableChatError(cause)) clearRequestId(scope, action);
      const code = chatErrorCode(cause);
      if (code === 'stale_revision' || code === 'proposal_not_creatable') onResync();
      setError(chatErrorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const { current } = proposal;
  return (
    <div className="grid gap-3 rounded-xl border bg-(--color-card) p-3 shadow-xs">
      <div className="flex items-center gap-2 text-xs font-semibold text-(--color-ink-dim)">
        <ClipboardList className="size-4" />
        Draft proposal · revision {revision}
      </div>

      {mode === 'invalidated' ? (
        <p className="flex items-center gap-2 text-sm text-(--color-ink-dim)">
          <AlertTriangle className="size-4" />
          Access to a source behind this proposal was lost, so it cannot be created.
        </p>
      ) : null}

      {current.missions.map(mission => (
        <section key={mission.key} className="grid gap-2 rounded-lg border px-3 py-2">
          <div>
            <div className="text-xs text-(--color-ink-dim)">{mission.projectName}</div>
            <div className="font-medium">{mission.title}</div>
          </div>
          {mission.audienceWarning ? (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {mission.audienceWarning}
            </p>
          ) : null}
          <ol className="grid gap-2">
            {mission.objectives.map((objective, index) => (
              <li key={`${mission.key}-${index}`} className="grid gap-1 text-sm">
                <div className="font-medium">
                  {index + 1}. {objective.title}
                </div>
                <p className="whitespace-pre-wrap text-(--color-ink-dim)">{objective.objective}</p>
                {objective.acceptanceCriteria.length > 0 ? (
                  <ul className="ml-4 list-disc text-xs text-(--color-ink-dim)">
                    {objective.acceptanceCriteria.map(criterion => (
                      <li key={criterion}>{criterion}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span>
                    <span className="text-(--color-ink-dim)">Agent </span>
                    <span className="font-mono">{assignmentLabel(objective.assignment)}</span>
                    <span className="text-(--color-ink-dim)">
                      {' '}
                      ({SOURCE_LABEL[objective.assignment.source]})
                    </span>
                  </span>
                  <span>
                    <span className="text-(--color-ink-dim)">Resource </span>
                    <span className="font-mono">{objective.resourceKey}</span>
                  </span>
                </div>
              </li>
            ))}
          </ol>
          {mission.dependencies.length > 0 ? (
            <p className="text-xs text-(--color-ink-dim)">
              Depends on: {mission.dependencies.join(', ')}
            </p>
          ) : null}
        </section>
      ))}

      {proposal.receipt ? (
        <div className="grid gap-1 text-sm">
          <div className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-4" />
            Created as drafts
          </div>
          <ul className="grid gap-1">
            {proposal.receipt.missions.map(mission => (
              <CreatedMissionLink key={mission.missionId} mission={mission} />
            ))}
          </ul>
        </div>
      ) : mode === 'cancelled' ? (
        <p className="text-sm text-(--color-ink-dim)">This proposal was withdrawn.</p>
      ) : (
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={mode !== 'creatable' || pending}
            onClick={() => void create()}
          >
            {pending ? 'Creating…' : error ? 'Retry Create' : 'Create drafts'}
          </Button>
          <span className="text-xs text-(--color-ink-dim)">
            Creates draft missions only. Nothing is queued or launched.
          </span>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A created draft, read live through the existing mission query (realtime keeps
 * it current, and the read is authorized for the viewer on every fetch).
 */
function CreatedMissionLink({ mission }: { mission: ChatCreatedMissionDto }) {
  const live = useMission(mission.missionId);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <Link
        to="/projects/$projectId/missions/$missionId"
        params={{ projectId: mission.projectId, missionId: mission.missionId }}
        search={{}}
        className="font-mono text-primary underline-offset-4 hover:underline"
      >
        {mission.missionDisplayId}
      </Link>
      {live.data ? <span className="text-sm">{live.data.title}</span> : null}
      <span className="text-xs text-(--color-ink-dim)">
        {live.data ? `${live.data.statusType} · ` : ''}
        {mission.objectiveIds.length} objective{mission.objectiveIds.length === 1 ? '' : 's'}
      </span>
    </li>
  );
}
