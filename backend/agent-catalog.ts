import { type Permission, PERMISSIONS } from '@overlord/auth';
import type {
  AgentCatalogAgentDto,
  AgentCatalogDto,
  UpdateAgentCatalogBody
} from '@overlord/contract';
import {
  readStoredWorkspaceAgentCatalog,
  type StoredAgentCatalog as StoredCatalog,
  type StoredCatalogAgent
} from '@overlord/core/service/workspace-agent-catalog';
import { type DatabaseClient } from '@overlord/database';

import { resolveInstanceAgentCatalog } from '../cli/src/agent-catalog.ts';
import { loadConfig } from '../cli/src/config.ts';

import { getImplicitWorkspaceIdOrNull, nowIso, requireDatabaseClient } from './db.ts';
import { ApiError } from './errors.ts';
import { requireWorkspacePermission } from './rbac.ts';
import { writeWorkspaceSetting } from './workspace-settings.ts';

/** Bundled defaults plus the instance's optional overlord.toml catalog overrides. */
export function instanceAgentCatalog(): Record<string, StoredCatalogAgent> {
  return resolveInstanceAgentCatalog({ configCatalog: loadConfig().agentCatalog });
}

/** Resolve without seeding; catalog management below owns persistence. */
export async function resolveWorkspaceAgentCatalog(
  db: DatabaseClient,
  workspaceId: string
): Promise<StoredCatalog> {
  return (
    (await readStoredWorkspaceAgentCatalog(db, workspaceId)) ?? { agents: instanceAgentCatalog() }
  );
}

async function persistCatalog(
  catalog: StoredCatalog,
  client: DatabaseClient,
  workspaceId: string
): Promise<void> {
  await writeWorkspaceSetting({
    workspaceId,
    key: 'agentCatalog',
    value: { ...catalog, updatedAt: nowIso() },
    client
  });
}

/**
 * Resolve which workspace a catalog operation targets. An explicit
 * `workspaceId` is authorized against the caller's own membership in *that*
 * workspace (coo:96/coo:135 pattern — independent of the active one, 404 for
 * non-members); omitted, it falls back to the request's active workspace,
 * whose route-level permission gate has already run.
 */
async function resolveCatalogWorkspaceId(
  workspaceId: string | undefined,
  permission: Permission,
  db: DatabaseClient
): Promise<string> {
  if (!workspaceId) {
    const fallback = getImplicitWorkspaceIdOrNull();
    if (!fallback) throw new ApiError(400, 'workspaceId is required');
    return fallback;
  }
  await requireWorkspacePermission({
    workspaceId,
    permission,
    db,
    notFoundMessage: 'Workspace not found or no active membership'
  });
  return workspaceId;
}

function toCatalogDto(stored: StoredCatalog): AgentCatalogDto {
  const config = loadConfig();
  const agents: AgentCatalogAgentDto[] = Object.entries(stored.agents).map(([key, agent]) => ({
    key,
    label: agent.label,
    availableByDefault: agent.availableByDefault !== false,
    models: (agent.models ?? []).map(m => ({
      id: m.id,
      displayName: m.displayName ?? m.id,
      reasoningOptions: Array.isArray(m.reasoningOptions) ? m.reasoningOptions : [],
      enabled: m.enabled !== false
    })),
    defaultModel: agent.defaultModel ?? null,
    defaultReasoningEffort: agent.defaultReasoningEffort ?? null,
    reasoningLabel: agent.reasoningLabel ?? 'Thinking'
  }));
  return {
    agents,
    defaultAgent: config.defaultAgent,
    defaultModel: config.defaultModel
  };
}

/**
 * Read a workspace's agent catalog, seeding it from the bundled default on
 * first use. Defaults to the request's active workspace; an explicit
 * `workspaceId` targets any workspace the caller is a member of.
 */
export async function getAgentCatalog(workspaceId?: string): Promise<AgentCatalogDto> {
  return requireDatabaseClient().transaction(async tx => {
    const targetWorkspaceId = await resolveCatalogWorkspaceId(
      workspaceId,
      PERMISSIONS.LAUNCH_READ,
      tx
    );
    let stored = await readStoredWorkspaceAgentCatalog(tx, targetWorkspaceId);
    if (!stored) {
      stored = await resolveWorkspaceAgentCatalog(tx, targetWorkspaceId);
      await persistCatalog(stored, tx, targetWorkspaceId);
    }
    return toCatalogDto(stored);
  });
}

/**
 * Merge the bundled default catalog into the workspace catalog: adds agents
 * and models that have shipped since the catalog was seeded while preserving
 * workspace customisations (labels, defaults, removed availability).
 */
export async function refreshAgentCatalog(workspaceId?: string): Promise<AgentCatalogDto> {
  return requireDatabaseClient().transaction(async tx => {
    const targetWorkspaceId = await resolveCatalogWorkspaceId(
      workspaceId,
      PERMISSIONS.LAUNCH_CONFIGURE,
      tx
    );
    const stored = (await readStoredWorkspaceAgentCatalog(tx, targetWorkspaceId)) ?? { agents: {} };
    for (const [key, bundled] of Object.entries(instanceAgentCatalog())) {
      const existing = stored.agents[key];
      if (!existing) {
        stored.agents[key] = structuredClone(bundled);
        continue;
      }
      const knownIds = new Set((existing.models ?? []).map(m => m.id));
      for (const model of bundled.models) {
        if (!knownIds.has(model.id)) existing.models.push(structuredClone(model));
      }
    }
    await persistCatalog(stored, tx, targetWorkspaceId);
    return toCatalogDto(stored);
  });
}

function storedCatalogFromBody(body: UpdateAgentCatalogBody): StoredCatalog {
  if (!body || !Array.isArray(body.agents)) {
    throw new ApiError(400, 'agents array is required');
  }

  const agents: Record<string, StoredCatalogAgent> = {};

  for (const agent of body.agents) {
    const key = agent.key?.trim();
    if (!key) throw new ApiError(400, 'Each agent must have a key');
    const label = agent.label?.trim();
    if (!label) throw new ApiError(400, `Agent ${key} must have a label`);
    if (!Array.isArray(agent.models) || agent.models.length === 0) {
      throw new ApiError(400, `Agent ${key} must have at least one model`);
    }

    const modelIds = new Set<string>();
    const models = agent.models.map(model => {
      const id = model.id?.trim();
      if (!id) throw new ApiError(400, `Model id is required for agent ${key}`);
      if (modelIds.has(id)) {
        throw new ApiError(400, `Duplicate model id ${id} in agent ${key}`);
      }
      modelIds.add(id);
      return {
        id,
        displayName: model.displayName?.trim() || id,
        reasoningOptions: Array.isArray(model.reasoningOptions)
          ? model.reasoningOptions
              .map(option => (typeof option === 'string' ? option.trim() : ''))
              .filter(option => option.length > 0)
          : [],
        // Round-trip the offer flag: dropping it here silently reverted every
        // "Offer" checkbox the settings page saved.
        enabled: model.enabled !== false
      };
    });

    if (
      agent.defaultModel !== null &&
      agent.defaultModel !== undefined &&
      !modelIds.has(agent.defaultModel)
    ) {
      throw new ApiError(400, `defaultModel must reference a model id in agent ${key}`);
    }

    if (
      agent.defaultReasoningEffort !== null &&
      agent.defaultReasoningEffort !== undefined &&
      agent.defaultModel !== null &&
      agent.defaultModel !== undefined
    ) {
      const defaultModel = models.find(model => model.id === agent.defaultModel);
      if (
        defaultModel &&
        defaultModel.reasoningOptions.length > 0 &&
        !defaultModel.reasoningOptions.includes(agent.defaultReasoningEffort)
      ) {
        throw new ApiError(
          400,
          `defaultReasoningEffort must be one of the default model's reasoning options for agent ${key}`
        );
      }
    }

    agents[key] = {
      label,
      availableByDefault: agent.availableByDefault !== false,
      models,
      defaultModel: agent.defaultModel ?? null,
      defaultReasoningEffort: agent.defaultReasoningEffort ?? null,
      reasoningLabel: agent.reasoningLabel?.trim() || 'Thinking'
    };
  }

  return { agents };
}

/** Replace the workspace agent catalog with a validated client payload. */
export async function updateAgentCatalog(
  body: UpdateAgentCatalogBody,
  workspaceId?: string
): Promise<AgentCatalogDto> {
  return requireDatabaseClient().transaction(async tx => {
    const targetWorkspaceId = await resolveCatalogWorkspaceId(
      workspaceId,
      PERMISSIONS.LAUNCH_CONFIGURE,
      tx
    );
    const stored = storedCatalogFromBody(body);
    const existing = (await readStoredWorkspaceAgentCatalog(tx, targetWorkspaceId)) ?? {
      agents: {}
    };

    for (const [key, agent] of Object.entries(stored.agents)) {
      const previous = existing.agents[key];
      if (previous?.launchDefaults) {
        agent.launchDefaults = previous.launchDefaults;
      }
    }

    await persistCatalog(stored, tx, targetWorkspaceId);
    return toCatalogDto(stored);
  });
}
