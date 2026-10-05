import type { ChatKnowledgebaseWriteDto } from '@overlord/contract';

/**
 * Knowledgebase write authorization for the assistant (contract v154).
 *
 * A run may write to one Knowledgebase workspace through one connection only when the
 * user explicitly authorized it on the message that started (or answered) the run.
 * Research-only runs, OAuth consent, and earlier runs never authorize a write. The
 * grant is stored on the run, so a resumed or continued run keeps exactly the scope
 * the user chose; it is re-checked against the live connection on every call.
 */

/** Reviewed Knowledgebase write tools (tool-policy version 2). */
export const KNOWLEDGEBASE_WRITE_TOOLS = [
  'create_node',
  'edit_file',
  'set_properties',
  'add_relation',
  'update_relation',
  'remove_relation'
] as const;
export type KnowledgebaseWriteTool = (typeof KNOWLEDGEBASE_WRITE_TOOLS)[number];

const WRITE_TOOLS: ReadonlySet<string> = new Set(KNOWLEDGEBASE_WRITE_TOOLS);

/** The reviewed write tool a namespaced `kb_<12 hex>_<tool>` id names, or null. */
export function knowledgebaseWriteTool(toolId: string): KnowledgebaseWriteTool | null {
  const tool = /^kb_[0-9a-f]{12}_([a-z_]{1,48})$/.exec(toolId)?.[1];
  return tool && WRITE_TOOLS.has(tool) ? (tool as KnowledgebaseWriteTool) : null;
}

const CONNECTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKSPACE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Shape check for a submitted grant: the normalized grant, `null` for no grant
 * (`undefined`/`null`), or `'invalid'`.
 */
export function parseKnowledgebaseWrite(
  value: unknown
): ChatKnowledgebaseWriteDto | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return 'invalid';
  const { connectionId, workspace, ...rest } = value as Record<string, unknown>;
  if (
    Object.keys(rest).length ||
    typeof connectionId !== 'string' ||
    !CONNECTION_ID.test(connectionId) ||
    typeof workspace !== 'string' ||
    !WORKSPACE.test(workspace)
  )
    return 'invalid';
  return { connectionId: connectionId.toLowerCase(), workspace };
}

/** Same grant (connection and workspace), for idempotent answers. */
export function sameKnowledgebaseWrite(
  a: ChatKnowledgebaseWriteDto | null,
  b: ChatKnowledgebaseWriteDto | null
): boolean {
  return a?.connectionId === b?.connectionId && a?.workspace === b?.workspace;
}

/** Stored `chat_runs.knowledgebase_write_json`; anything malformed is no grant (fail closed). */
export function storedKnowledgebaseWrite(json: unknown): ChatKnowledgebaseWriteDto | null {
  if (!json) return null;
  try {
    const grant = parseKnowledgebaseWrite(typeof json === 'string' ? JSON.parse(json) : json);
    return grant === 'invalid' ? null : grant;
  } catch {
    return null;
  }
}

/** The result a write receives when its outcome cannot be known (interrupted mid-call). */
export const UNCERTAIN_WRITE_RESULT = {
  outcome: 'uncertain',
  content: {
    error: 'uncertain',
    message:
      'This Knowledgebase write was interrupted after it was sent, so it may or may not have been applied. Reread the node, relation, or path by its stable id before deciding whether to try again; never repeat a create blindly.'
  },
  evidence: []
} as const;
