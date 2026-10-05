import {
  readStoredWorkspaceAgentCatalog,
  type StoredAgentCatalog,
  type StoredCatalogAgent
} from '@overlord/core/service/workspace-agent-catalog';
import type { DatabaseClient } from '@overlord/database';

import { resolveInstanceAgentCatalog } from '../cli/src/agent-catalog.ts';
import { loadConfig } from '../cli/src/config.ts';

/** Bundled defaults plus the instance's optional overlord.toml catalog overrides. */
export function instanceAgentCatalog(): Record<string, StoredCatalogAgent> {
  return resolveInstanceAgentCatalog({ configCatalog: loadConfig().agentCatalog });
}

/** Resolve without seeding; launch catalog management owns persistence. */
export async function resolveWorkspaceAgentCatalog(
  db: DatabaseClient,
  workspaceId: string
): Promise<StoredAgentCatalog> {
  return (
    (await readStoredWorkspaceAgentCatalog(db, workspaceId)) ?? { agents: instanceAgentCatalog() }
  );
}
