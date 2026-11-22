import type { TerminalSessionDto } from '@overlord/contract';

import { parseMetadataJson } from './execution-requests.ts';
import { providerSessionFromMetadata } from './latch-launch.ts';
import { launchSessionSnapshotFromMetadata } from './terminal-profile-types.ts';

export type TerminalSessionProjectionRow = {
  execution_request_id: string;
  objective_id: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
  target_label: string | null;
  device_label: string | null;
};

export function projectTerminalSession(
  row: TerminalSessionProjectionRow,
  archived = false
): TerminalSessionDto | null {
  const metadata = parseMetadataJson(row.metadata_json ?? '');
  const providerSession =
    providerSessionFromMetadata(metadata) ??
    (archived
      ? providerSessionFromMetadata({ providerSession: metadata.endedTerminalSession })
      : null);
  if (!providerSession) return null;
  const snapshot = launchSessionSnapshotFromMetadata(metadata);
  const state = providerSession.lastObservedState;
  const lastObservedState =
    state === 'exited' || state === 'stopping' || state === 'lost' ? state : 'running';
  const ended = lastObservedState === 'exited';
  const createdAt = Date.parse(providerSession.createdAt);
  return {
    executionRequestId: row.execution_request_id,
    objectiveId: row.objective_id,
    provider: 'latch',
    providerSessionId: providerSession.providerSessionId,
    sessionName: providerSession.sessionName ?? providerSession.providerSessionId,
    executionTargetId: providerSession.executionTargetId,
    deviceLabel: row.device_label ?? row.target_label,
    agentSessionId: providerSession.agentSessionId,
    executable: snapshot?.executionProvider.executable ?? 'latch',
    viewerKind: snapshot?.viewer.kind ?? 'iterm',
    viewerOpenAs: snapshot?.viewer.openAs ?? 'window',
    // Older runner reports could omit the provider timestamp.
    createdAt: Number.isFinite(createdAt) ? new Date(createdAt).toISOString() : row.created_at,
    lastObservedState,
    endedAt: ended ? (providerSession.endedAt ?? row.updated_at) : null,
    endReason: ended ? (providerSession.endReason ?? 'unknown') : null
  };
}
