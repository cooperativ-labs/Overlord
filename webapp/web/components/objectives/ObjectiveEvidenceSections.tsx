import { GitBranch } from 'lucide-react';

import type {
  DeliveryDto,
  ObjectiveAttachmentDto,
  ObjectiveDto
} from '../../../shared/contract.ts';
import type { ObjectiveEvidence } from '../../lib/objective-evidence.ts';
import { AgentSessionActivity } from '../agent-session/AgentSessionActivity.tsx';
import { MissionDeliveryCard } from '../DeliverySummaryCard.tsx';
import { InlineEditField } from '../InlineEditField.tsx';
import { LiveFileChangeList } from '../LiveFileChangeList.tsx';
import { ObjectiveTerminalSessions } from '../ObjectiveTerminalSessions.tsx';

import { ObjectiveAttachmentList } from './ObjectiveAttachments.tsx';
import { ObjectiveEvidenceEmpty, ObjectiveEvidenceRule } from './ObjectiveEvidenceRule.tsx';

/**
 * Which arrangement of the evidence stack to draw (coo:879 §4.2 / §4.3 / §4.5):
 *
 * - `complete` — instruction → deliveries → terminal session → file changes →
 *   attachments. The reading order the brief asks for.
 * - `active` — the live things first: terminal session → agent activity →
 *   file changes (live) → prior deliveries (only on a pending-delivery
 *   re-attach) → instruction last.
 * - `history` — deliveries → terminal session → file changes, with no
 *   instruction (the reverted draft's editable field already shows it) and no
 *   attachments (the draft's own footer lists them).
 */
export type ObjectiveEvidenceMode = 'complete' | 'active' | 'history';

export type ObjectiveEvidenceLoading = {
  deliveries: boolean;
  fileChanges: boolean;
};

function runLabel(index: number, total: number): string {
  // `deliveries` is newest first, so the oldest run is run 1.
  return total > 1 ? `Run ${total - index} of ${total}` : 'Delivery';
}

/**
 * The objective's deliveries, newest first. The latest is the open card; any
 * earlier runs are compact collapsed rows — the one place collapsing is used
 * among primary evidence, because earlier runs are secondary information.
 * Run numbers come from `deliveredAt` order rather than objective timestamps,
 * because `completedAt` is overwritten when a reverted objective completes
 * again (plan §2.3).
 */
function ObjectiveDeliveries({
  deliveries,
  expandLatest
}: {
  deliveries: readonly DeliveryDto[];
  expandLatest: boolean;
}) {
  return (
    <div className="grid gap-2">
      {deliveries.map((delivery, index) => (
        <MissionDeliveryCard
          key={delivery.id}
          delivery={delivery}
          objectiveTitle={runLabel(index, deliveries.length)}
          defaultExpanded={expandLatest && index === 0}
        />
      ))}
    </div>
  );
}

function ObjectiveInstruction({ objective }: { objective: ObjectiveDto }) {
  return (
    <div>
      {objective.branch ? (
        <p className="mb-2 flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground/80">
          <GitBranch className="h-3 w-3 shrink-0" />
          <span className="truncate">{objective.branch}</span>
        </p>
      ) : null}
      {objective.externalSessionId ? (
        <p className="mb-2 truncate font-mono text-[11px] text-muted-foreground/80">
          Agent session: {objective.externalSessionId}
        </p>
      ) : null}
      <div className="text-sm leading-relaxed text-muted-foreground">
        <InlineEditField
          multiline
          disabled
          value={objective.instructionText}
          className="block whitespace-pre-wrap"
          ariaLabel="Objective instruction"
          onSave={() => undefined}
        />
      </div>
    </div>
  );
}

function LiveTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-500/15 px-1 py-px font-mono text-[9px] tracking-normal text-emerald-700 dark:text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      live
    </span>
  );
}

/**
 * The flat, full-width stack of everything one objective produced, rendered
 * inside its accordion (coo:879 §4.2). Sections are separated by thin labeled
 * rules, never nested behind collapsibles; only secondary rows (earlier runs,
 * individual file-change cards) fold. Empty states are one-line muted italics
 * so "ran with no changes" reads distinctly from "still loading".
 */
export function ObjectiveEvidenceSections({
  objective,
  evidence,
  attachments = [],
  mode,
  loading
}: {
  objective: ObjectiveDto;
  evidence: ObjectiveEvidence;
  attachments?: readonly ObjectiveAttachmentDto[];
  mode: ObjectiveEvidenceMode;
  loading: ObjectiveEvidenceLoading;
}) {
  const deliveries = (
    <>
      {loading.deliveries ? (
        <ObjectiveEvidenceEmpty>Loading deliveries…</ObjectiveEvidenceEmpty>
      ) : evidence.deliveries.length === 0 ? (
        <ObjectiveEvidenceEmpty>No delivery recorded</ObjectiveEvidenceEmpty>
      ) : (
        <ObjectiveDeliveries deliveries={evidence.deliveries} expandLatest={mode !== 'active'} />
      )}
    </>
  );

  const terminalSessions = (
    <ObjectiveTerminalSessions
      sessions={evidence.terminalSessions}
      emptyState={<ObjectiveEvidenceEmpty>No terminal session</ObjectiveEvidenceEmpty>}
    />
  );

  const fileChanges = loading.fileChanges ? (
    <ObjectiveEvidenceEmpty>Loading file changes…</ObjectiveEvidenceEmpty>
  ) : (
    <LiveFileChangeList
      projectId={objective.projectId}
      fileChanges={evidence.fileChanges}
      emptyState={<ObjectiveEvidenceEmpty>No file changes</ObjectiveEvidenceEmpty>}
    />
  );

  const fileChangeCount = loading.fileChanges ? undefined : evidence.fileChanges.length;
  const deliveryCount = loading.deliveries ? undefined : evidence.deliveries.length;

  if (mode === 'active') {
    return (
      <div className="grid gap-2">
        {terminalSessions}
        <AgentSessionActivity missionId={objective.missionId} objectiveId={objective.id} />
        <ObjectiveEvidenceRule
          label="File changes"
          count={fileChangeCount}
          trailing={<LiveTag />}
        />
        {fileChanges}
        {evidence.deliveries.length > 0 ? (
          <>
            <ObjectiveEvidenceRule label="Deliveries" count={deliveryCount} />
            {deliveries}
          </>
        ) : null}
        <ObjectiveEvidenceRule label="Instruction" />
        <ObjectiveInstruction objective={objective} />
        {attachments.length > 0 ? (
          <>
            <ObjectiveEvidenceRule label="Attachments" count={attachments.length} />
            <ObjectiveAttachmentList attachments={[...attachments]} readOnly className="-ml-2" />
          </>
        ) : null}
      </div>
    );
  }

  if (mode === 'history') {
    return (
      <div className="grid gap-2">
        <ObjectiveEvidenceRule label="Deliveries" count={deliveryCount} />
        {deliveries}
        <ObjectiveEvidenceRule label="Terminal session" />
        {terminalSessions}
        <ObjectiveEvidenceRule label="File changes" count={fileChangeCount} />
        {fileChanges}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <ObjectiveInstruction objective={objective} />
      <ObjectiveEvidenceRule label="Deliveries" count={deliveryCount} />
      {deliveries}
      <ObjectiveEvidenceRule label="Terminal session" />
      {terminalSessions}
      <ObjectiveEvidenceRule label="File changes" count={fileChangeCount} />
      {fileChanges}
      {attachments.length > 0 ? (
        <>
          <ObjectiveEvidenceRule label="Attachments" count={attachments.length} />
          <ObjectiveAttachmentList attachments={[...attachments]} readOnly className="-ml-2" />
        </>
      ) : null}
    </div>
  );
}
