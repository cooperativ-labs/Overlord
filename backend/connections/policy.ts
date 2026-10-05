import {
  KNOWLEDGEBASE_WRITE_TOOLS,
  type KnowledgebaseWriteTool
} from '../../packages/core/service/chat/knowledgebase-writes.ts';

/**
 * Reviewed Knowledgebase tool policy (tool-policy version 2, contract v154).
 *
 * Reviewed against the Knowledgebase MCP server source (`packages/mcp/src/server.ts`
 * and the generated annotations in `packages/client/coverage.ts`). The schemas and
 * descriptions here are Overlord's own: server-supplied descriptions and schemas are
 * untrusted and never shown to the model, and server annotations can only remove a
 * tool, never add one.
 *
 * - Reads (version 1 plus `query` and `get_registries`) are exposed only while the
 *   server annotates them `readOnlyHint: true` and not destructive. `query` is a POST
 *   that the Knowledgebase marks semantically read-only (its M1 coverage change).
 * - Writes (`create_node`, `edit_file`, `set_properties`, `add_relation`,
 *   `update_relation`, `remove_relation`) are exposed only for a run whose user
 *   authorized that connection and workspace. A write the server annotates destructive
 *   is withheld unless it was reviewed as destructive (`remove_relation` only).
 *   Revision guards are required by the schema (`expected_version`,
 *   `expected_metadata_revision`, `expected_revision`); the Knowledgebase enforces them.
 * - Schema administration, sharing, credentials, moves and deletion stay outside the
 *   policy. There is no Knowledgebase OAuth write scope: a connection acts with its
 *   user's grants minus their restrictions, and the Knowledgebase refuses (403) what
 *   the user cannot edit.
 */
export const KNOWLEDGEBASE_TOOL_POLICY_VERSION = 2;

type JsonSchema = {
  /** Omitted: any JSON value (including null) within {@link JSON_BOUNDS}. */
  type?: 'object' | 'string' | 'integer' | 'number' | 'array' | 'boolean';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  /** `false` closes the object; a schema describes the values of an open map. */
  additionalProperties?: false | JsonSchema;
  maxProperties?: number;
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
  access: 'read' | 'write';
  /** Reviewed as destructive; any other write the server marks destructive is withheld. */
  destructive?: boolean;
  /** Serialized argument bound for this tool. */
  maxArgumentBytes: number;
  /**
   * Metadata reads whose output is used for guarded writes or complete listings: a
   * response that does not fit is refused rather than truncated.
   */
  complete?: boolean;
}

/** Bounds for untyped (nested) JSON values: property values, attributes, predicates. */
export const JSON_BOUNDS = { depth: 8, nodes: 4000, stringChars: 16 * 1024, keyChars: 128 };

const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const workspace: JsonSchema = {
  type: 'string',
  description: 'Knowledgebase workspace slug, from list_workspaces.',
  pattern: '^[a-z0-9][a-z0-9-]{0,62}$'
};
const uuid = (description: string): JsonSchema => ({ type: 'string', description, pattern: UUID });
const nodeId = uuid('Node UUID.');
const path: JsonSchema = {
  type: 'string',
  description: 'Workspace-relative document path.',
  minLength: 1,
  maxLength: 512
};
const limit = (max: number): JsonSchema => ({ type: 'integer', minimum: 1, maximum: max });
const cursor: JsonSchema = { type: 'string', maxLength: 512 };
const name = (description: string): JsonSchema => ({
  type: 'string',
  description,
  minLength: 1,
  maxLength: 64
});
const revision = (description: string): JsonSchema => ({
  type: 'integer',
  description,
  minimum: 0
});
const anyJson = (description: string): JsonSchema => ({ description });
const map = (description: string, maxProperties: number, values: JsonSchema): JsonSchema => ({
  type: 'object',
  description,
  additionalProperties: values,
  maxProperties
});
const object = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
});
const BODY_CHARS = 24 * 1024;

const READS: readonly ReviewedTool[] = [
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
    description:
      'Read one Knowledgebase document by path, with its metadata and expected_version (pass that to edit_file).',
    inputSchema: object({ workspace, path }, ['workspace', 'path'])
  },
  {
    name: 'get_related',
    description:
      "Get a node's properties (with metadata_revision) and its typed relations (with relation ids and revisions) to other nodes.",
    inputSchema: object({ workspace, node_id: nodeId }, ['workspace', 'node_id']),
    complete: true
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
        resource_id: uuid('Resource UUID.'),
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
  },
  {
    name: 'query',
    description:
      'Find nodes by entity type (for example "feature"), property predicates and relations. where is JSON containment; where_in matches any listed value; where_empty matches missing, null or empty keys; every rel entry must match. order_by sorts by a numeric attribute of the explicit relation to one rel target (for Features ranked in a Project: {relation: {type: "project", to_node_id}, key: "rank"}), unranked last. include adds properties with metadata_revision and outgoing relations with relation ids, revisions and attributes. Paged (at most 100): follow next_cursor until it is absent; a missing next_cursor is the only proof that a listing is complete.',
    inputSchema: object(
      {
        workspace,
        type: name('Entity type name or alias, e.g. feature.'),
        where: map('Property containment predicates.', 16, anyJson('Property value.')),
        where_in: map('Properties matching any listed value.', 8, {
          type: 'array',
          items: anyJson('Allowed value.'),
          maxItems: 50
        }),
        where_empty: {
          type: 'array',
          description: 'Property keys that must be missing, null or empty.',
          items: { type: 'string', minLength: 1, maxLength: 128 },
          maxItems: 16
        },
        rel: {
          type: 'array',
          items: object({ type: name('Relation type name.'), to_node_id: nodeId }),
          maxItems: 4
        },
        order_by: object(
          {
            relation: object({ type: name('Relation type name.'), to_node_id: nodeId }, [
              'type',
              'to_node_id'
            ]),
            key: name('Numeric relation attribute, e.g. rank.'),
            direction: { type: 'string', enum: ['asc', 'desc'] }
          },
          ['relation', 'key']
        ),
        include: {
          type: 'array',
          items: { type: 'string', enum: ['properties', 'relations'] },
          maxItems: 2
        },
        limit: limit(100),
        cursor
      },
      ['workspace']
    ),
    complete: true
  },
  {
    name: 'get_registries',
    description:
      'List the entity, relation and resource types of a workspace with their stable ids, aliases and schemas. Use before creating typed nodes or relations.',
    inputSchema: object({ workspace }, ['workspace']),
    complete: true
  }
].map(tool => ({ access: 'read' as const, maxArgumentBytes: 4 * 1024, ...tool }));

const WRITES: Record<KnowledgebaseWriteTool, Omit<ReviewedTool, 'name' | 'access'>> = {
  create_node: {
    description:
      'Create a new document or folder. Link the note to what it is about with inline body lines such as project:: [[Clear Comply]]. entity_type_id comes from get_registries. Returns the new node with its id and versions.',
    inputSchema: object(
      {
        workspace,
        path,
        expected_version: {
          type: 'string',
          description: 'Always "new" (create only).',
          enum: ['new']
        },
        entity_type_id: uuid('Entity type id from get_registries.'),
        kind: { type: 'string', enum: ['file', 'folder'] },
        content: { type: 'string', description: 'Markdown body.', maxLength: BODY_CHARS },
        content_type: { type: 'string', maxLength: 100 },
        properties: map('Explicit properties to set.', 64, anyJson('Property value.'))
      },
      ['workspace', 'path', 'expected_version']
    ),
    maxArgumentBytes: 48 * 1024
  },
  edit_file: {
    description:
      'Replace exactly one occurrence of old_text in a document (old_text "" writes an empty document). Requires expected_version from read_file; a changed document returns a conflict instead of overwriting.',
    inputSchema: object(
      {
        workspace,
        path,
        old_text: { type: 'string', maxLength: BODY_CHARS },
        new_text: { type: 'string', maxLength: BODY_CHARS },
        expected_version: { type: 'string', minLength: 1, maxLength: 200 }
      },
      ['workspace', 'path', 'old_text', 'new_text', 'expected_version']
    ),
    maxArgumentBytes: 56 * 1024
  },
  set_properties: {
    description:
      'Set explicit properties on a node. Only the keys passed change; null removes an explicit property. Requires expected_metadata_revision (metadata_revision from get_related or query include properties). Text-derived fields must be edited in their document; content_updated_at is server-maintained.',
    inputSchema: object(
      {
        workspace,
        node_id: nodeId,
        properties: map('Keys to set; null removes.', 32, anyJson('Property value, or null.')),
        expected_metadata_revision: revision('The node metadata_revision you read.')
      },
      ['workspace', 'node_id', 'properties', 'expected_metadata_revision']
    ),
    maxArgumentBytes: 32 * 1024
  },
  add_relation: {
    description:
      'Create an explicit typed relation between two node ids (relation_type name or relation_type_id from get_registries), with optional attributes such as a citations list. Prefer inline relation:: [[Title]] lines when the target can be named in a body.',
    inputSchema: object(
      {
        workspace,
        from_node_id: nodeId,
        to_node_id: nodeId,
        relation_type_id: uuid('Relation type id from get_registries.'),
        relation_type: name('Relation type name.'),
        attributes: map('Relation attributes.', 32, anyJson('Attribute value.'))
      },
      ['workspace', 'from_node_id', 'to_node_id']
    ),
    maxArgumentBytes: 32 * 1024
  },
  update_relation: {
    description:
      'Replace the attributes of an explicit relation. Read it first (get_related or query include relations) for its id, revision and current attributes; attributes are replaced wholesale, so carry over every key you are not changing. Requires expected_revision.',
    inputSchema: object(
      {
        workspace,
        relation_id: uuid('Relation UUID.'),
        attributes: map('The complete new attributes.', 32, anyJson('Attribute value.')),
        expected_revision: revision('The relation revision you read.')
      },
      ['workspace', 'relation_id', 'attributes', 'expected_revision']
    ),
    maxArgumentBytes: 32 * 1024
  },
  remove_relation: {
    description:
      'Remove one explicit relation (for example unlinking a Project). Requires its expected_revision. Inline relations are removed by editing their declaring document instead.',
    inputSchema: object(
      {
        workspace,
        relation_id: uuid('Relation UUID.'),
        expected_revision: revision('The relation revision you read.')
      },
      ['workspace', 'relation_id', 'expected_revision']
    ),
    destructive: true,
    maxArgumentBytes: 4 * 1024
  }
};

export const REVIEWED_KNOWLEDGEBASE_TOOLS: readonly ReviewedTool[] = [
  ...READS,
  ...KNOWLEDGEBASE_WRITE_TOOLS.map(tool => ({
    name: tool,
    access: 'write' as const,
    ...WRITES[tool]
  }))
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
  if (reviewed.access === 'read') {
    if (serverTool.annotations?.readOnlyHint !== true) return null;
    if (serverTool.annotations?.destructiveHint === true) return null;
    return reviewed;
  }
  // A write is never exposed as read-only, and only a reviewed-destructive write may be destructive.
  if (serverTool.annotations?.destructiveHint === true && !reviewed.destructive) return null;
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

/** Default serialized argument bound (reads); writes carry their own. */
export const MAX_ARGUMENT_BYTES = 4 * 1024;

/** Validates arguments against a reviewed schema. Returns an error label or null. */
export function validateArguments(
  schema: JsonSchema,
  value: unknown,
  at = 'arguments'
): string | null {
  const budget = { nodes: 0 };
  return validate(schema, value, at, 0, budget);
}

function validate(
  schema: JsonSchema,
  value: unknown,
  at: string,
  depth: number,
  budget: { nodes: number }
): string | null {
  if (++budget.nodes > JSON_BOUNDS.nodes) return `${at} is too large`;
  if (depth > JSON_BOUNDS.depth) return `${at} is nested too deeply`;
  switch (schema.type) {
    case undefined:
      return validateJson(value, at, depth, budget);
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return `${at} must be an object`;
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? [])
        if (record[key] === undefined) return `${at}.${key} is required`;
      const keys = Object.keys(record);
      if (schema.maxProperties !== undefined && keys.length > schema.maxProperties)
        return `${at} has too many properties`;
      for (const key of keys) {
        const child =
          schema.properties?.[key] ??
          (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null);
        if (!child) return `${at}.${key} is not allowed`;
        if (!key.length || key.length > JSON_BOUNDS.keyChars) return `${at} has an invalid key`;
        const error = validate(child, record[key], `${at}.${key}`, depth + 1, budget);
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
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${at} must be a number`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${at} is too small`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${at} is too large`;
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${at} must be a boolean`;
    case 'array':
      if (!Array.isArray(value)) return `${at} must be an array`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems)
        return `${at} has too many items`;
      for (const [index, item] of value.entries()) {
        const error = schema.items
          ? validate(schema.items, item, `${at}[${index}]`, depth + 1, budget)
          : validateJson(item, `${at}[${index}]`, depth + 1, budget);
        if (error) return error;
      }
      return null;
  }
}

/** Any JSON value, bounded: null, booleans, finite numbers, bounded strings, arrays, objects. */
function validateJson(
  value: unknown,
  at: string,
  depth: number,
  budget: { nodes: number }
): string | null {
  if (++budget.nodes > JSON_BOUNDS.nodes) return `${at} is too large`;
  if (depth > JSON_BOUNDS.depth) return `${at} is nested too deeply`;
  if (value === null || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${at} must be finite`;
  if (typeof value === 'string')
    return value.length > JSON_BOUNDS.stringChars ? `${at} is too long` : null;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const error = validateJson(item, `${at}[${index}]`, depth + 1, budget);
      if (error) return error;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!key.length || key.length > JSON_BOUNDS.keyChars) return `${at} has an invalid key`;
      const error = validateJson(item, `${at}.${key}`, depth + 1, budget);
      if (error) return error;
    }
    return null;
  }
  return `${at} is not JSON`;
}
