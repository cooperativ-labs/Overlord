import { PERMISSIONS } from '@overlord/auth';
import type { ReportDraftV1 } from '@overlord/contract';

import { listObjectiveReportDrafts } from '../packages/core/service/report-draft.ts';

import { requireDatabaseClient } from './db.ts';
import { requireObjectivePermission } from './rbac.ts';

/**
 * Read-only operator projection of an objective's provisional report drafts
 * (ADR 0078). Drafts are never mission items, badges, obligations, seen
 * state or completion; people cannot edit them.
 */
export async function listObjectiveReportDraftsForOperator(
  objectiveRef: string
): Promise<{ objectiveId: string; drafts: ReportDraftV1[] }> {
  const db = requireDatabaseClient();
  const { objectiveId, workspaceId } = await requireObjectivePermission({
    objectiveId: objectiveRef,
    permission: PERMISSIONS.MISSION_READ,
    db
  });
  const drafts = await listObjectiveReportDrafts(db, { workspaceId, objectiveId, limit: 20 });
  return { objectiveId, drafts };
}
