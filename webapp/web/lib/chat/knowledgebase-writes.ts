import type { AccountConnectionDto, ChatKnowledgebaseWriteDto } from '@overlord/contract';

/** One workspace the user may allow the assistant to edit for a single request. */
export interface KnowledgebaseWriteTarget {
  key: string;
  grant: ChatKnowledgebaseWriteDto;
  label: string;
}

function liveKnowledgebase(connections: readonly AccountConnectionDto[] | undefined) {
  return (connections ?? []).filter(c => c.provider === 'knowledgebase' && c.state === 'connected');
}

/**
 * Writable targets for the composer (contract v154): every authorized workspace of the
 * caller's connected Knowledgebase connections. Choosing one is the explicit, per-request
 * authorization; the server re-checks it on submission and on every write. Connections
 * that already allow edits in every workspace (v158) need no per-request grant.
 */
export function knowledgebaseWriteTargets(
  connections: readonly AccountConnectionDto[] | undefined
): KnowledgebaseWriteTarget[] {
  const live = liveKnowledgebase(connections);
  return live
    .filter(c => c.assistantWriteScope !== 'all_workspaces')
    .flatMap(connection =>
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

/**
 * True when a connected Knowledgebase connection lets the assistant edit every
 * authorized workspace without a per-request grant (v158).
 */
export function knowledgebaseEditsEverywhere(
  connections: readonly AccountConnectionDto[] | undefined
): boolean {
  return liveKnowledgebase(connections).some(c => c.assistantWriteScope === 'all_workspaces');
}
