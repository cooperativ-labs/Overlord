import { deriveTitleFromInstructionText, generateObjectiveTitle } from '@overlord/automations';

import { nowIso, recordChange, requireDatabaseClient } from '../db.ts';
import { realtime } from '../realtime.ts';

type MissionContext = {
  missionId: string;
  projectId: string;
};

async function updateMissionTitle({
  missionId,
  title
}: {
  missionId: string;
  title: string;
}): Promise<void> {
  const existing = await requireDatabaseClient().get<{
    id: string;
    workspace_id: string;
    project_id: string;
    title: string;
    revision: number;
  }>(
    `SELECT id, workspace_id, project_id, title, revision
       FROM missions
      WHERE id = ? AND deleted_at IS NULL`,
    [missionId]
  );

  if (!existing || existing.title === title) {
    return;
  }

  const now = nowIso();
  const revision = existing.revision + 1;
  await requireDatabaseClient().run(
    `UPDATE missions SET title = ?, updated_at = ?, revision = ? WHERE id = ?`,
    [title, now, revision, missionId]
  );

  await recordChange({
    entityType: 'mission',
    entityId: missionId,
    operation: 'update',
    entityRevision: revision,
    projectId: existing.project_id,
    missionId,
    changedFields: ['title'],
    workspaceId: existing.workspace_id
  });
}

function notifyAfterTitleAutomation(task: Promise<void>): void {
  void task
    .then(() => {
      void realtime.pollNow();
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[webapp] title automation failed:', message);
    });
}

/**
 * Immediate local title for create flows. Objective titles are refined by the
 * durable objective-brief worker (ADR 0058); mission titles by the calls below.
 */
export function initialTitleFromInstruction(instructionText: string): string {
  return deriveTitleFromInstructionText(instructionText.trim());
}

export function scheduleMissionTitleGeneration(
  params: MissionContext & { instructionText: string }
): void {
  notifyAfterTitleAutomation(
    generateObjectiveTitle({
      instructionText: params.instructionText,
      env: process.env
    }).then((title: string) => {
      if (!title) {
        return;
      }
      return updateMissionTitle({ missionId: params.missionId, title });
    })
  );
}

/**
 * Synchronous counterpart to {@link scheduleMissionTitleGeneration} for the
 * manual "Generate title" button: awaits the summarizer and persists the
 * result before responding, so the caller can show the title (or a failure)
 * immediately instead of waiting on a realtime echo.
 */
export async function generateMissionTitleNow(
  params: MissionContext & { instructionText: string }
): Promise<string> {
  const title = await generateObjectiveTitle({
    instructionText: params.instructionText,
    env: process.env
  });
  if (!title) {
    return '';
  }
  await updateMissionTitle({ missionId: params.missionId, title });
  return title;
}
