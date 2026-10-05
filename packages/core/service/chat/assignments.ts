import type { ChatAssignmentCatalog } from './store.js';

/** Catalog discovery exposes selection data only, never launch commands, flags or target configuration. */
export function assignmentCatalogProjection(value: unknown): ChatAssignmentCatalog {
  const out: ChatAssignmentCatalog = { agents: Object.create(null) };
  if (!value || typeof value !== 'object' || !('agents' in value)) return out;
  const agents = value.agents;
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return out;
  for (const [key, raw] of Object.entries(agents)) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.models)) continue;
    out.agents[key] = {
      defaultModel: typeof raw.defaultModel === 'string' ? raw.defaultModel : null,
      defaultReasoningEffort:
        typeof raw.defaultReasoningEffort === 'string' ? raw.defaultReasoningEffort : null,
      models: raw.models
        .filter((m: unknown): m is { id: string; reasoningOptions?: unknown; enabled?: boolean } =>
          Boolean(m && typeof m === 'object' && 'id' in m && typeof m.id === 'string')
        )
        .map((m: { id: string; reasoningOptions?: unknown; enabled?: boolean }) => ({
          id: m.id,
          reasoningOptions: Array.isArray(m.reasoningOptions)
            ? m.reasoningOptions.filter((r: unknown): r is string => typeof r === 'string')
            : [],
          enabled: m.enabled !== false
        }))
    };
  }
  return out;
}
