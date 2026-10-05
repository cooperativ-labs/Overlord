import type { AgentLaunchConfigDto } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

export interface StoredCatalogAgent {
  label: string;
  availableByDefault: boolean;
  models: Array<{
    id: string;
    displayName: string;
    reasoningOptions: string[];
    /** Absent means offered; `false` keeps the model stored but out of pickers. */
    enabled?: boolean;
  }>;
  defaultModel: string | null;
  defaultReasoningEffort: string | null;
  reasoningLabel: string;
  /** Optional workspace-wide launch default (lowest-priority config source). */
  launchDefaults?: AgentLaunchConfigDto;
}

export type StoredAgentCatalog = {
  agents: Record<string, StoredCatalogAgent>;
  updatedAt?: string;
};

/** Read only the stored catalog of a live workspace; instance defaults belong to the caller. */
export async function readStoredWorkspaceAgentCatalog(
  db: DatabaseClient,
  workspaceId: string
): Promise<StoredAgentCatalog | null> {
  const row = await db.get<{ settings_json: string }>(
    'SELECT settings_json FROM workspaces WHERE id = ? AND deleted_at IS NULL',
    [workspaceId]
  );
  if (!row) return null;
  try {
    const stored = JSON.parse(row.settings_json)?.agentCatalog;
    if (
      !stored ||
      typeof stored !== 'object' ||
      Array.isArray(stored) ||
      !stored.agents ||
      typeof stored.agents !== 'object' ||
      Array.isArray(stored.agents)
    )
      return null;
    return stored as StoredAgentCatalog;
  } catch {
    return null;
  }
}
