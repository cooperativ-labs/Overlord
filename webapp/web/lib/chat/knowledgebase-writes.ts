import type { AccountConnectionDto, ChatKnowledgebaseWriteDto } from '@overlord/contract';

/** One workspace the user may allow the assistant to edit for a single request. */
export interface KnowledgebaseWriteTarget {
  key: string;
  grant: ChatKnowledgebaseWriteDto;
  label: string;
}

/**
 * Writable targets for the composer (contract v154): every authorized workspace of the
 * caller's connected Knowledgebase connections. Choosing one is the explicit, per-request
 * authorization; the server re-checks it on submission and on every write.
 */
export function knowledgebaseWriteTargets(
  connections: readonly AccountConnectionDto[] | undefined
): KnowledgebaseWriteTarget[] {
  const live = (connections ?? []).filter(
    c => c.provider === 'knowledgebase' && c.state === 'connected'
  );
  return live.flatMap(connection =>
    connection.authorizedWorkspaces.map(workspace => ({
      key: `${connection.id}:${workspace}`,
      grant: { connectionId: connection.id, workspace },
      label: live.length > 1 ? `${workspace} (${connection.serverUrl})` : workspace
    }))
  );
}

/** Stable key for request-id reuse: a changed grant is a different request. */
export function grantKey(grant: ChatKnowledgebaseWriteDto | null): string {
  return grant ? `${grant.connectionId}:${grant.workspace}` : 'read';
}
