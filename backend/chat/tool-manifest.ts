import { createHash } from 'node:crypto';

import type { ChatToolDeclaration } from '../../packages/core/service/chat/tools.ts';

export const RELEVANCE_POLICY_VERSION = 'expandable-families-v1';
export const TOOL_FAMILIES = ['status', 'repository', 'knowledgebase', 'feature'] as const;
export type ToolFamily = (typeof TOOL_FAMILIES)[number];
export const EXPAND_CAPABILITIES_TOOL = 'expand_capabilities';
export const EXPANSION_DECLARATION: ChatToolDeclaration = {
  name: EXPAND_CAPABILITIES_TOOL,
  description:
    'Discover available capabilities (omit families), or add tool families for the next turn: status (missions), repository (code), knowledgebase (notes and authorized edits), feature (handoff). Use all when unsure. This changes relevance only, never permissions. Tools outside the current manifest need expansion before calling.',
  parameters: {
    type: 'object',
    properties: {
      families: {
        type: 'array',
        maxItems: 5,
        items: { type: 'string', enum: [...TOOL_FAMILIES, 'all'] }
      }
    },
    additionalProperties: false
  }
};

export interface ToolManifest {
  policy: typeof RELEVANCE_POLICY_VERSION;
  families: ToolFamily[];
  declarations: ChatToolDeclaration[];
  id: string;
}

/** Conservative lexical routing; unknown/referential requests retain the full catalog. */
export function initialFamilies(text: string, writeGrant = false): ToolFamily[] {
  const selected = new Set<ToolFamily>();
  if (
    /\b(mission|missions|objective|objectives|delivery|deliveries|status|blocked|queue)\b|\b\w+:\d+/i.test(
      text
    )
  )
    selected.add('status');
  if (
    /\b(repository|repositories|repo|repos|code|codebase|file|files|branch|branches|checkout|git|implementation)\b|\b\w+\.(ts|tsx|js|py|swift|md)\b/i.test(
      text
    )
  )
    selected.add('repository');
  if (
    /\b(knowledgebase|notes?|meeting|meetings|transcript|transcripts)\b/i.test(text) ||
    writeGrant
  )
    selected.add('knowledgebase');
  if (/\b(feature|features|handoff|hand off)\b/i.test(text)) selected.add('feature');
  if (
    !selected.size ||
    /\b(that|those|it|earlier|previous|above|continue|everything|anything|all sources)\b/i.test(
      text
    )
  )
    return [...TOOL_FAMILIES];
  return TOOL_FAMILIES.filter(f => selected.has(f));
}

export function toolFamilies(d: ChatToolDeclaration): ToolFamily[] {
  if (d.name.startsWith('kb_')) return ['knowledgebase', 'feature'];
  if (d.name === 'overlord_find_feature_missions') return ['feature'];
  if (d.name === 'overlord_get_mission') return ['status', 'feature'];
  if (d.name === 'overlord_search_missions') return ['status'];
  if (['repository_read', 'overlord_list_execution_targets'].includes(d.name))
    return ['repository'];
  return []; // Shared discovery, questions and proposal preparation.
}

function common(d: ChatToolDeclaration): boolean {
  return !toolFamilies(d).length || /^kb_.*_list_workspaces$/.test(d.name);
}

function digest(value: Omit<ToolManifest, 'id'>): string {
  // PostgreSQL JSONB normalizes object key order; array/declaration/call order is semantic.
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, canonical(item)])
      );
    return v;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function createToolManifest(
  catalog: ChatToolDeclaration[],
  families: ToolFamily[]
): ToolManifest {
  const value: Omit<ToolManifest, 'id'> = {
    policy: RELEVANCE_POLICY_VERSION,
    families: TOOL_FAMILIES.filter(f => families.includes(f)),
    declarations: [
      ...catalog.filter(d => common(d) || toolFamilies(d).some(f => families.includes(f))),
      EXPANSION_DECLARATION
    ]
  };
  return { ...value, id: digest(value) };
}

/** Private storage integrity check; the manifest never supplies authorization. */
export function validToolManifest(value: unknown): value is ToolManifest {
  if (!value || typeof value !== 'object') return false;
  const v = value as ToolManifest;
  if (
    v.policy !== RELEVANCE_POLICY_VERSION ||
    !Array.isArray(v.families) ||
    !Array.isArray(v.declarations) ||
    !v.families.every(f => TOOL_FAMILIES.includes(f)) ||
    new Set(v.families).size !== v.families.length ||
    !v.declarations.every(
      d =>
        d &&
        typeof d.name === 'string' &&
        typeof d.description === 'string' &&
        d.parameters &&
        typeof d.parameters === 'object' &&
        (d.effect === undefined || d.effect === 'read' || d.effect === 'write')
    ) ||
    new Set(v.declarations.map(d => d.name)).size !== v.declarations.length
  )
    return false;
  return v.id === digest({ policy: v.policy, families: v.families, declarations: v.declarations });
}

export function expandedFamilies(current: ToolFamily[], requested: unknown): ToolFamily[] {
  const list = Array.isArray(requested) ? requested : [];
  return TOOL_FAMILIES.filter(f => current.includes(f) || list.includes(f) || list.includes('all'));
}

export function capabilities(catalog: ChatToolDeclaration[]) {
  return TOOL_FAMILIES.map(family => ({
    family,
    tools: catalog.filter(d => toolFamilies(d).includes(family)).map(d => d.name)
  }));
}
