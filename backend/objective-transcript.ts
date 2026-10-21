import { PERMISSIONS } from '@overlord/auth';

import {
  parseTranscriptRead,
  readObjectiveTranscript
} from '../packages/core/service/objective-transcript.ts';

import { getActiveTokenProjectIds, requireDatabaseClient } from './db.ts';
import { actorCan } from './rbac.ts';
import { callerMembershipsInActiveOrganization } from './repository.ts';

export async function listObjectiveTranscript(query: Record<string, unknown> = {}) {
  const read = parseTranscriptRead(query);
  const db = requireDatabaseClient();
  const workspaceIds: string[] = [];
  for (const scope of await callerMembershipsInActiveOrganization(db)) {
    if (
      (await actorCan(PERMISSIONS.MISSION_READ, scope)) &&
      (await actorCan(PERMISSIONS.OBJECTIVE_READ, scope))
    )
      workspaceIds.push(scope.workspaceId);
  }
  return readObjectiveTranscript({
    db,
    workspaceIds,
    allowedProjectIds: getActiveTokenProjectIds(),
    read
  });
}
