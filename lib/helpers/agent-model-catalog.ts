import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { type AgentTypeValue, LAUNCH_AGENT_VALUES } from '@/lib/helpers/agent-types';

export type AgentModel = {
  id: string;
  agent_type: string;
  model_id: string;
  display_name: string;
  thinking_options: string[];
  capabilities: Record<string, unknown>;
  is_recommended: boolean;
  sort_order: number;
  updated_at: string;
};

type AgentModelCatalogEntry = {
  id: string;
  label: string;
  thinkingLevels: string[];
};

type AgentModelCatalogAgents = Partial<Record<AgentTypeValue, AgentModelCatalogEntry[] | null>>;

export type AgentModelCatalog = {
  version: number;
  description?: string;
  agents: AgentModelCatalogAgents;
};

const AGENT_MODEL_CATALOG_PATH = path.join(process.cwd(), 'agent-models.json');

function isCatalogEntry(value: unknown): value is AgentModelCatalogEntry {
  if (!value || typeof value !== 'object') return false;

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.label === 'string' &&
    Array.isArray(entry.thinkingLevels) &&
    entry.thinkingLevels.every(level => typeof level === 'string')
  );
}

function isCatalogAgents(value: unknown): value is AgentModelCatalogAgents {
  if (!value || typeof value !== 'object') return false;

  for (const [agent, entries] of Object.entries(value as Record<string, unknown>)) {
    if (!LAUNCH_AGENT_VALUES.includes(agent as AgentTypeValue)) return false;
    if (entries !== null && (!Array.isArray(entries) || !entries.every(isCatalogEntry))) {
      return false;
    }
  }

  return true;
}

function isAgentModelCatalog(value: unknown): value is AgentModelCatalog {
  if (!value || typeof value !== 'object') return false;

  const catalog = value as Record<string, unknown>;
  return typeof catalog.version === 'number' && isCatalogAgents(catalog.agents);
}

export async function readAgentModelCatalog(): Promise<AgentModelCatalog | null> {
  try {
    const raw = await readFile(AGENT_MODEL_CATALOG_PATH, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return isAgentModelCatalog(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildOverrideModels(
  agentType: string,
  entries: AgentModelCatalogEntry[],
  updatedAt: string
): AgentModel[] {
  return entries.map((entry, index) => ({
    id: `${agentType}:${entry.id}`,
    agent_type: agentType,
    model_id: entry.id,
    display_name: entry.label,
    thinking_options: entry.thinkingLevels,
    capabilities: { source: 'agent-models.json' },
    is_recommended: false,
    sort_order: index,
    updated_at: updatedAt
  }));
}

export function applyAgentModelCatalog(
  dbModels: AgentModel[],
  catalog: AgentModelCatalog | null,
  agentType?: string
): AgentModel[] {
  const modelsByAgent = new Map<string, AgentModel[]>();

  for (const model of dbModels) {
    const current = modelsByAgent.get(model.agent_type) ?? [];
    current.push(model);
    modelsByAgent.set(model.agent_type, current);
  }

  const catalogAgents = catalog?.agents ?? {};
  const orderedAgents = agentType
    ? [agentType]
    : Array.from(
        new Set<string>([
          ...LAUNCH_AGENT_VALUES,
          ...Object.keys(catalogAgents),
          ...Array.from(modelsByAgent.keys())
        ])
      );

  const updatedAt = new Date().toISOString();
  const resolved: AgentModel[] = [];

  for (const agent of orderedAgents) {
    const override = catalogAgents[agent as AgentTypeValue];
    if (Array.isArray(override)) {
      resolved.push(...buildOverrideModels(agent, override, updatedAt));
      continue;
    }

    resolved.push(...(modelsByAgent.get(agent) ?? []));
  }

  return resolved;
}
