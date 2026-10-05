/**
 * Reviewed Knowledgebase read-tool policy (tool-policy version 1).
 *
 * Reviewed against the Knowledgebase MCP server source (`packages/mcp/src`):
 * each tool below is backed only by HTTP GET operations, so the server
 * annotates it `readOnlyHint: true, destructiveHint: false`. The schemas and
 * descriptions here are Overlord's own: server-supplied descriptions and
 * schemas are untrusted and never shown to the model. Server annotations can
 * only remove a tool (a reviewed tool that stops being annotated read-only is
 * withheld); they can never add one. `query` reads but is a POST and is not
 * reviewed; every write tool is rejected by name regardless of annotations.
 */
export const KNOWLEDGEBASE_TOOL_POLICY_VERSION = 1;

type JsonSchema = {
  type: 'object' | 'string' | 'integer' | 'array' | 'boolean';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: false;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  items?: JsonSchema;
  maxItems?: number;
};

export interface ReviewedTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const workspace: JsonSchema = {
  type: 'string',
  description: 'Knowledgebase workspace slug, from list_workspaces.',
  pattern: '^[a-z0-9][a-z0-9-]{0,62}$'
};
const nodeId: JsonSchema = { type: 'string', description: 'Node UUID.', pattern: UUID };
const path: JsonSchema = {
  type: 'string',
  description: 'Workspace-relative document path.',
  minLength: 1,
  maxLength: 512
};
const limit = (max: number): JsonSchema => ({ type: 'integer', minimum: 1, maximum: max });
const cursor: JsonSchema = { type: 'string', maxLength: 512 };
const object = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
});

export const REVIEWED_KNOWLEDGEBASE_TOOLS: readonly ReviewedTool[] = [
  {
    name: 'list_workspaces',
    description: 'List the Knowledgebase workspaces this connection can read.',
    inputSchema: object({})
  },
  {
    name: 'search',
    description:
      'Search notes, people, companies, projects, and meetings in one Knowledgebase workspace. Returns matching nodes with ids and paths.',
    inputSchema: object(
      {
        workspace,
        q: { type: 'string', minLength: 1, maxLength: 500 },
        type: { type: 'string', maxLength: 64 },
        path_prefix: { type: 'string', maxLength: 512 },
        limit: limit(25),
        cursor
      },
      ['workspace', 'q']
    )
  },
  {
    name: 'read_file',
    description: 'Read one Knowledgebase document by path, with its metadata and version.',
    inputSchema: object({ workspace, path }, ['workspace', 'path'])
  },
  {
    name: 'get_related',
    description: 'Get a node and its typed relations to other nodes.',
    inputSchema: object({ workspace, node_id: nodeId }, ['workspace', 'node_id'])
  },
  {
    name: 'list_children',
    description: 'List the children of a node, such as the notes under a project.',
    inputSchema: object(
      {
        workspace,
        node_id: nodeId,
        type: { type: 'string', maxLength: 64 },
        relation: { type: 'string', maxLength: 64 },
        category: { type: 'string', enum: ['markdown', 'resource'] },
        limit: limit(50),
        cursor
      },
      ['workspace', 'node_id']
    )
  },
  {
    name: 'get_links',
    description: 'List the Markdown links into or out of a document.',
    inputSchema: object(
      {
        workspace,
        path,
        node_id: nodeId,
        direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'] }
      },
      ['workspace']
    )
  },
  {
    name: 'read_resource',
    description: 'Read a semantic resource (an entity page) as text.',
    inputSchema: object(
      {
        workspace,
        resource_id: { ...nodeId, description: 'Resource UUID.' },
        format: { type: 'string', enum: ['text', 'markdown'] }
      },
      ['workspace', 'resource_id']
    )
  },
  {
    name: 'list_entities',
    description: 'List entities of a type, such as projects or people.',
    inputSchema: object(
      { workspace, type: { type: 'string', maxLength: 64 }, limit: limit(50), cursor },
      ['workspace']
    )
  }
];

const REVIEWED = new Map(REVIEWED_KNOWLEDGEBASE_TOOLS.map(tool => [tool.name, tool]));

export function reviewedTool(name: string): ReviewedTool | null {
  return REVIEWED.get(name) ?? null;
}

/** Server-side tool facts used only to narrow the reviewed list. */
export interface ServerTool {
  name: string;
  annotations?: { readOnlyHint?: unknown; destructiveHint?: unknown } | null;
}

export function exposable(serverTool: ServerTool): ReviewedTool | null {
  const reviewed = reviewedTool(serverTool.name);
  if (!reviewed) return null;
  if (serverTool.annotations?.readOnlyHint !== true) return null;
  if (serverTool.annotations?.destructiveHint === true) return null;
  return reviewed;
}

/**
 * Namespaced tool id, unique per connection: `kb_<connection prefix>_<tool>` (≤ 64 chars).
 * Letters, digits and underscores only: the provider rewrote a dotted id
 * (`kb.<prefix>.<tool>` came back as `kb.<prefix>:<tool>`), which made every
 * Knowledgebase call an unknown tool.
 */
export function namespacedToolId(connectionId: string, tool: string): string {
  return `kb_${connectionId.replaceAll('-', '').slice(0, 12)}_${tool}`;
}

export function parseToolId(id: string): { connectionPrefix: string; tool: string } | null {
  const match = /^kb_([0-9a-f]{12})_([a-z_]{1,48})$/.exec(id);
  return match ? { connectionPrefix: match[1]!, tool: match[2]! } : null;
}

export const MAX_ARGUMENT_BYTES = 4 * 1024;

/** Validates arguments against a reviewed schema. Returns an error label or null. */
export function validateArguments(
  schema: JsonSchema,
  value: unknown,
  at = 'arguments'
): string | null {
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return `${at} must be an object`;
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? [])
        if (record[key] === undefined) return `${at}.${key} is required`;
      for (const [key, item] of Object.entries(record)) {
        const child = schema.properties?.[key];
        if (!child) return `${at}.${key} is not allowed`;
        const error = validateArguments(child, item, `${at}.${key}`);
        if (error) return error;
      }
      return null;
    }
    case 'string':
      if (typeof value !== 'string') return `${at} must be a string`;
      if (schema.minLength !== undefined && value.length < schema.minLength)
        return `${at} is too short`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        return `${at} is too long`;
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${at} is malformed`;
      if (schema.enum && !schema.enum.includes(value)) return `${at} is not an allowed value`;
      return null;
    case 'integer':
      if (!Number.isSafeInteger(value)) return `${at} must be an integer`;
      if (schema.minimum !== undefined && (value as number) < schema.minimum)
        return `${at} is too small`;
      if (schema.maximum !== undefined && (value as number) > schema.maximum)
        return `${at} is too large`;
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${at} must be a boolean`;
    case 'array':
      if (!Array.isArray(value)) return `${at} must be an array`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems)
        return `${at} has too many items`;
      for (const [index, item] of value.entries()) {
        const error = schema.items
          ? validateArguments(schema.items, item, `${at}[${index}]`)
          : null;
        if (error) return error;
      }
      return null;
  }
}
