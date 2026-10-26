import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ObjectiveDto, ObjectiveFileChangesDto } from '../../../shared/contract.ts';
import {
  describeCaptureSession,
  summarizeObjectiveFileEvidence
} from '../../lib/objective-file-changes.ts';
import { useObjectiveFileChanges } from '../../lib/queries.ts';
import { LiveFileChangeList } from '../LiveFileChangeList.tsx';

import {
  ObjectiveEvidenceEmpty,
  ObjectiveEvidenceSection,
  ObjectiveEvidenceTruncationNotice
} from './ObjectiveEvidenceRule.tsx';

export const OBJECTIVE_FILE_CHANGES_LABEL = 'Files changed during this objective';

function CaptureWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="grid gap-0.5" role="status">
      {warnings.map(warning => (
        <li
          key={warning}
          className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300"
        >
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{warning}</span>
        </li>
      ))}
    </ul>
  );
}

/** Per-session binding, callback and health codes, on demand. */
function CaptureDetails({
  sessions
}: {
  sessions: ObjectiveFileChangesDto['capture']['sessions'];
}) {
  if (sessions.length === 0) return null;
  return (
    <details className="text-[11px] text-[var(--color-ink-dim)]">
      <summary className="cursor-pointer select-none">
        Capture details · {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
      </summary>
      <ol className="mt-1 grid gap-0.5 pl-4">
        {sessions.map((session, index) => (
          <li key={session.sessionId} className="list-decimal">
            <span className="font-mono">Session {index + 1}</span>:{' '}
            {describeCaptureSession(session)}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** The body for a loaded objective read: rows or an honest empty state, then caveats. */
export function ObjectiveFileChangesBody({
  projectId,
  data
}: {
  projectId: string;
  data: ObjectiveFileChangesDto;
}) {
  const summary = summarizeObjectiveFileEvidence(data);
  let body: ReactNode;
  if (summary.state === 'listed') {
    body = <LiveFileChangeList projectId={projectId} fileChanges={data.items} />;
  } else if (summary.state === 'none_captured') {
    body = (
      <ObjectiveEvidenceEmpty>
        No file changes were captured
        {summary.warnings.length > 0 ? ', and tracking was incomplete' : ''}.
      </ObjectiveEvidenceEmpty>
    );
  } else {
    body = (
      <ObjectiveEvidenceEmpty>
        File tracking was not available for this objective, so no file list exists.
      </ObjectiveEvidenceEmpty>
    );
  }

  return (
    <>
      {body}
      {summary.truncationNotice ? (
        <ObjectiveEvidenceTruncationNotice>
          {summary.truncationNotice}
        </ObjectiveEvidenceTruncationNotice>
      ) : null}
      <CaptureWarnings warnings={summary.warnings} />
      <CaptureDetails sessions={data.capture.sessions} />
    </>
  );
}

/**
 * The objective's cumulative changed-file list (one section per objective, not
 * per run), read from the server objective projection: filtered before the
 * 200-row cap and carrying the persisted capture diagnostics. The rule shows the
 * pre-cap total and a warning mark when tracking was incomplete, so both are
 * visible while the section is closed. `changed_file` and `agent_session`
 * entity changes refresh it through the shared mission file-change prefix.
 */
export function ObjectiveFileChanges({
  objective,
  trailing
}: {
  objective: Pick<ObjectiveDto, 'id' | 'missionId' | 'projectId'>;
  /** Extra inline rule content, e.g. the `live` tag on an executing objective. */
  trailing?: ReactNode;
}) {
  const query = useObjectiveFileChanges(objective.missionId, objective.id);
  const data = query.data;
  const hasWarnings = (data?.capture.warnings.length ?? 0) > 0;

  return (
    <ObjectiveEvidenceSection
      label={OBJECTIVE_FILE_CHANGES_LABEL}
      count={data?.total}
      trailing={
        <>
          {hasWarnings ? (
            <TriangleAlert
              className="h-3 w-3 text-amber-600 dark:text-amber-300"
              aria-label="File tracking was incomplete"
            />
          ) : null}
          {trailing}
        </>
      }
    >
      {query.isLoading ? (
        <ObjectiveEvidenceEmpty>Loading file changes…</ObjectiveEvidenceEmpty>
      ) : query.isError || !data ? (
        <p className="py-1 text-xs text-red-400">
          Could not load file changes: {(query.error as Error | null)?.message ?? 'unknown error'}
        </p>
      ) : (
        <ObjectiveFileChangesBody projectId={objective.projectId} data={data} />
      )}
    </ObjectiveEvidenceSection>
  );
}
