import { PERMISSIONS } from '@overlord/auth';
import type {
  ChatSourceLocatorDto,
  RepositoryReadRequest,
  RepositoryReadResult
} from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import type { ServiceContext } from '../context.js';
import { readProjectLaunchSelection, searchMissionsV3 } from '../missions.js';
import { getProjectExecutionTargetSelection } from '../project-execution-target.js';
import { listProjectResources } from '../projects.js';
import { parseRepositoryReadRequest } from '../repository-reads.js';

import { ChatAccess, type ChatWorkspaceGrant } from './access.js';
import { assignmentCatalogProjection } from './assignments.js';
import type { ChatAssignmentCatalog, ChatOwner } from './store.js';

/**
 * Authorized tool gateway for the assistant (contract v152 §Tools, coo:1108.vx29).
 *
 * The tool list is fixed by Overlord: Overlord reads, repository reads, reviewed
 * Knowledgebase reads, and `ask_user`. No tool creates, changes, or launches work.
 * Every call is validated against Overlord-authored schemas and resolved against the
 * thread owner's live permissions at call time; model arguments and tool content are
 * untrusted and can never add a tool or widen a scope.
 */

/** JSON Schema subset used for provider function declarations. */
export interface ChatToolSchema {
  type: 'object' | 'string' | 'integer' | 'array' | 'boolean';
  description?: string;
  properties?: Record<string, ChatToolSchema>;
  required?: string[];
  additionalProperties?: false;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  items?: ChatToolSchema;
  maxItems?: number;
}

export interface ChatToolDeclaration {
  name: string;
  description: string;
  parameters: ChatToolSchema;
}

/** One source a tool result drew on; becomes a `chat_source_refs` row and an evidence row. */
export interface ChatToolSource {
  scopeKey: string;
  locator: ChatSourceLocatorDto;
  label: string;
  excerpt: string | null;
  truncated: boolean;
  revision: string | null;
  observedAt: string;
}

export type ChatToolOutcome =
  | 'ok'
  | 'unknown_tool'
  | 'invalid_arguments'
  | 'not_found'
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'reauthorization_required'
  | 'tool_error';

export interface ChatToolOutput {
  outcome: ChatToolOutcome;
  /** Bounded JSON for provider input. Never contains credentials or absolute paths. */
  content: unknown;
  sources: ChatToolSource[];
}

/** Structural view of the backend Knowledgebase client (backend/connections/mcp-client.ts). */
export interface ChatKnowledgebaseAdapter {
  tools(
    owner: ChatOwner,
    signal?: AbortSignal
  ): Promise<{ id: string; connectionId: string; description: string; inputSchema: unknown }[]>;
  call(
    owner: ChatOwner,
    toolId: string,
    args: unknown,
    signal?: AbortSignal
  ): Promise<{
    outcome: string;
    text: string;
    truncated: boolean;
    workspace: string | null;
    sources: {
      locator: Extract<ChatSourceLocatorDto, { kind: 'knowledgebase' }>;
      revision: string | null;
      updatedAt: string | null;
    }[];
    observedAt: string;
    detail: string | null;
  }>;
}

export type ChatRepositoryReader = (args: {
  ctx: ServiceContext;
  request: RepositoryReadRequest;
  scopeKey: string;
  signal: AbortSignal | null;
}) => Promise<RepositoryReadResult>;

export const ASK_USER_TOOL = 'ask_user';
export const PREPARE_PROPOSAL_TOOL = 'prepare_proposal';

/** Provider-input bound per tool result; the stored receipt limit is 128 KiB. */
export const CHAT_TOOL_CONTENT_BYTES = 96 * 1024;
const EXCERPT_CHARS = 600;

const obj = (properties: Record<string, ChatToolSchema>, required: string[] = []) =>
  ({ type: 'object', properties, required, additionalProperties: false }) as ChatToolSchema;
const id = (description: string): ChatToolSchema => ({
  type: 'string',
  description,
  minLength: 1,
  maxLength: 200
});
const relPath: ChatToolSchema = {
  type: 'string',
  description: 'Repository-relative POSIX path. Never an absolute path.',
  minLength: 1,
  maxLength: 1024
};

export const OVERLORD_TOOL_DECLARATIONS: readonly ChatToolDeclaration[] = [
  {
    name: 'overlord_list_projects',
    description:
      'List the Overlord projects the user can read in this organization, with workspace, description, launch preference and registered resources (resourceKey, label, primary). assignmentCatalogs lists the supported agents and models once per workspace. Use it to resolve project names to stable project ids. Read only.',
    parameters: obj({
      query: {
        type: 'string',
        description: 'Optional case-insensitive filter on name, slug or description.',
        maxLength: 200
      },
      limit: { type: 'integer', minimum: 1, maximum: 50 }
    })
  },
  {
    name: 'overlord_list_execution_targets',
    description:
      'List the execution targets (machines with checkouts) the user may inspect for one project, and whether each is reachable now. Read only.',
    parameters: obj({ projectId: id('Project id from overlord_list_projects.') }, ['projectId'])
  },
  {
    name: 'overlord_search_missions',
    description:
      'Search missions, objectives and deliveries across the projects the user can read. Returns ranked missions with matching objective and delivery snippets. Read only.',
    parameters: obj(
      {
        query: { type: 'string', minLength: 1, maxLength: 300 },
        projectId: id('Optional project id to restrict the search.'),
        statusTypes: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'string',
            enum: ['draft', 'next', 'execute', 'review', 'complete', 'blocked']
          }
        },
        limit: { type: 'integer', minimum: 1, maximum: 20 }
      },
      ['query']
    )
  },
  {
    name: 'overlord_get_mission',
    description:
      'Read one mission by id or display id (for example coo:123): its objectives and latest deliveries. Read only.',
    parameters: obj({ missionId: id('Mission UUID or display id.') }, ['missionId'])
  },
  {
    name: 'repository_read',
    description:
      'Inspect a registered repository resource on an execution target, read only. Operations: observe, tree, branches, worktrees, git_status, diff (scope unstaged|staged|all), read_file (relativePath, optional startLine/endLine), search_text (literal query, optional relativePath). Inputs name the execution target, project and resource key; paths are repository-relative. Never fetches, checks out, builds or writes. Independent reads may be requested together.',
    parameters: obj(
      {
        executionTargetId: id('From overlord_list_execution_targets.'),
        projectId: id('Project id.'),
        resourceKey: {
          type: 'string',
          description: 'Resource key, e.g. primary.',
          minLength: 1,
          maxLength: 100
        },
        operation: {
          type: 'string',
          enum: [
            'observe',
            'tree',
            'branches',
            'worktrees',
            'git_status',
            'diff',
            'read_file',
            'search_text'
          ]
        },
        relativePath: relPath,
        relativePaths: { type: 'array', maxItems: 50, items: relPath },
        scope: { type: 'string', enum: ['unstaged', 'staged', 'all'] },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
        query: { type: 'string', minLength: 1, maxLength: 256 },
        caseSensitive: { type: 'boolean' },
        maxEntries: { type: 'integer', minimum: 1, maximum: 2000 }
      },
      ['executionTargetId', 'projectId', 'resourceKey', 'operation']
    )
  },
  {
    name: PREPARE_PROPOSAL_TOOL,
    description:
      'Prepare or revise a proposal card ONLY when the user asks for drafts. Does not create or launch work. Use explicit project ids, registered resource keys, ordered objectives and acceptance criteria. Omit assignment to inherit a valid project preference; if no justified supported assignment exists, ask_user for agent/model. To revise, pass proposalId and expectedRevision. Dependencies name other mission keys in this proposal.',
    parameters: obj(
      {
        proposalId: id('Existing proposal id to revise.'),
        expectedRevision: { type: 'integer', minimum: 1 },
        missions: {
          type: 'array',
          maxItems: 10,
          items: obj(
            {
              key: id('Stable mission key within this proposal.'),
              projectId: id('Destination project id.'),
              title: { type: 'string', minLength: 1, maxLength: 500 },
              dependencies: { type: 'array', maxItems: 10, items: id('Mission key.') },
              objectives: {
                type: 'array',
                maxItems: 20,
                items: obj(
                  {
                    title: { type: 'string', minLength: 1, maxLength: 500 },
                    objective: { type: 'string', minLength: 1, maxLength: 20000 },
                    resourceKey: id('Registered resource key.'),
                    acceptanceCriteria: {
                      type: 'array',
                      maxItems: 50,
                      items: { type: 'string', minLength: 1, maxLength: 2000 }
                    },
                    evidenceIds: {
                      type: 'array',
                      maxItems: 100,
                      items: id('Evidence id from a tool result.')
                    },
                    assignment: obj(
                      {
                        agent: id('Supported agent key.'),
                        model: id('Supported model id.'),
                        reasoningEffort: id('Supported reasoning option; omit for none.')
                      },
                      ['agent', 'model']
                    )
                  },
                  ['title', 'objective', 'resourceKey', 'acceptanceCriteria']
                )
              }
            },
            ['key', 'projectId', 'title', 'objectives']
          )
        }
      },
      ['missions']
    )
  },
  {
    name: ASK_USER_TOOL,
    description:
      'Ask the user one clarifying question and wait for the answer, for example when two projects could own the work or the request is ambiguous. Ask at most one question at a time.',
    parameters: obj(
      {
        question: { type: 'string', minLength: 1, maxLength: 2000 },
        options: {
          type: 'array',
          maxItems: 8,
          items: obj(
            {
              id: { type: 'string', minLength: 1, maxLength: 64 },
              label: { type: 'string', minLength: 1, maxLength: 200 }
            },
            ['id', 'label']
          )
        },
        allowFreeText: { type: 'boolean' }
      },
      ['question']
    )
  }
];

/** Validates `value` against an Overlord schema. Returns an error label, or null when valid. */
export function validateToolArguments(
  schema: ChatToolSchema,
  value: unknown,
  path = 'arguments'
): string | null {
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path}_not_object`;
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? [])
        if (record[key] === undefined || record[key] === null) return `${path}.${key}_required`;
      for (const [key, item] of Object.entries(record)) {
        const child = schema.properties?.[key];
        if (!child) {
          if (schema.additionalProperties === false) return `${path}.${key}_not_allowed`;
          continue;
        }
        if (item === undefined || item === null) continue;
        const error = validateToolArguments(child, item, `${path}.${key}`);
        if (error) return error;
      }
      return null;
    }
    case 'string':
      if (typeof value !== 'string') return `${path}_not_string`;
      if (schema.minLength !== undefined && value.length < schema.minLength)
        return `${path}_too_short`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        return `${path}_too_long`;
      if (schema.enum && !schema.enum.includes(value)) return `${path}_not_allowed_value`;
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path}_bad_format`;
      return null;
    case 'integer':
      if (!Number.isSafeInteger(value)) return `${path}_not_integer`;
      if (schema.minimum !== undefined && (value as number) < schema.minimum)
        return `${path}_too_small`;
      if (schema.maximum !== undefined && (value as number) > schema.maximum)
        return `${path}_too_large`;
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${path}_not_boolean`;
    case 'array':
      if (!Array.isArray(value)) return `${path}_not_array`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems)
        return `${path}_too_many`;
      for (let i = 0; i < value.length; i++) {
        const error = schema.items
          ? validateToolArguments(schema.items, value[i], `${path}.${i}`)
          : null;
        if (error) return error;
      }
      return null;
  }
}

const clip = (text: string | null | undefined, max: number): string | null => {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/** Cuts a UTF-8 string to `maxBytes` on a code-point boundary. */
function cutUtf8(text: string, maxBytes: number): { text: string; cut: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, cut: false };
  const buffer = Buffer.from(text, 'utf8').subarray(0, maxBytes);
  return { text: buffer.toString('utf8').replace(/�+$/, ''), cut: true };
}

function failure(outcome: ChatToolOutcome, message: string): ChatToolOutput {
  return { outcome, content: { error: outcome, message }, sources: [] };
}

export interface ChatToolGatewayOptions {
  db: DatabaseClient;
  assignmentCatalog?: (workspaceId: string) => Promise<ChatAssignmentCatalog>;
  knowledgebase?: ChatKnowledgebaseAdapter | null;
  readRepository?: ChatRepositoryReader | null;
  now?: () => number;
}

export class ChatToolGateway {
  readonly access: ChatAccess;
  constructor(private readonly options: ChatToolGatewayOptions) {
    this.access = new ChatAccess(options.db);
  }
  private now() {
    return new Date(this.options.now?.() ?? Date.now()).toISOString();
  }

  /**
   * Declarations for one provider request. Knowledgebase tools are the reviewed,
   * server-confirmed read tools of the owner's live connections; nothing else is added.
   */
  async declarations(owner: ChatOwner, signal?: AbortSignal): Promise<ChatToolDeclaration[]> {
    const out = OVERLORD_TOOL_DECLARATIONS.filter(
      d => d.name !== 'repository_read' || this.options.readRepository
    ).map(d => ({ ...d }));
    if (this.options.knowledgebase) {
      let tools: Awaited<ReturnType<ChatKnowledgebaseAdapter['tools']>> = [];
      try {
        tools = await this.options.knowledgebase.tools(owner, signal);
      } catch {
        tools = []; // An unavailable connection contributes no tools; readiness explains why.
      }
      for (const tool of tools)
        out.push({
          name: tool.id,
          description: `Knowledgebase (read only): ${tool.description}`,
          parameters: tool.inputSchema as ChatToolSchema
        });
    }
    return out;
  }

  /**
   * Executes one reviewed read for the owner. `declared` is the tool list the provider
   * was offered for this turn: a name outside it is rejected even if it exists elsewhere.
   */
  async invoke(args: {
    owner: ChatOwner;
    runId: string;
    operationId: string;
    name: string;
    arguments: unknown;
    declared: readonly ChatToolDeclaration[];
    signal?: AbortSignal;
  }): Promise<ChatToolOutput> {
    const declaration = args.declared.find(d => d.name === args.name);
    if (!declaration || args.name === ASK_USER_TOOL || args.name === PREPARE_PROPOSAL_TOOL)
      return failure('unknown_tool', 'No such read tool is available.');
    const invalid = validateToolArguments(declaration.parameters, args.arguments ?? {});
    if (invalid) return failure('invalid_arguments', invalid);
    const input = (args.arguments ?? {}) as Record<string, unknown>;
    switch (args.name) {
      case 'overlord_list_projects':
        return this.listProjects(args.owner, input);
      case 'overlord_list_execution_targets':
        return this.listTargets(args.owner, String(input.projectId));
      case 'overlord_search_missions':
        return this.searchMissions(args.owner, input);
      case 'overlord_get_mission':
        return this.getMission(args.owner, String(input.missionId));
      case 'repository_read':
        return this.readRepository(args.owner, args.runId, args.operationId, input, args.signal);
      default:
        return this.knowledgebase(args.owner, args.name, input, args.signal);
    }
  }

  private projectSource(
    project: { id: string; name: string; description?: string | null },
    observedAt: string
  ): ChatToolSource {
    return {
      scopeKey: `overlord:project:${project.id}`,
      locator: {
        kind: 'overlord',
        entityType: 'project',
        entityId: project.id,
        projectId: project.id
      },
      label: `Project ${project.name}`,
      excerpt: clip(project.description ?? null, EXCERPT_CHARS),
      truncated: false,
      revision: null,
      observedAt
    };
  }

  private async listProjects(owner: ChatOwner, input: Record<string, unknown>) {
    const observedAt = this.now();
    const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
    const limit = Number(input.limit ?? 30);
    const grants = await this.access.grants(owner, PERMISSIONS.PROJECT_READ);
    const projects: Record<string, unknown>[] = [];
    const sources: ChatToolSource[] = [];
    // One catalog per workspace, not per project: repeated per project it dominated the
    // result (about 3 KB each) and would pass the provider-input bound at thirty projects.
    const assignmentCatalogs: Record<string, unknown>[] = [];
    let total = 0;
    for (const grant of grants) {
      let listed = false;
      const rows = await this.options.db.all<{
        id: string;
        slug: string;
        name: string;
        description: string | null;
      }>(
        `SELECT id, slug, name, description FROM projects WHERE workspace_id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY name, id`,
        [grant.workspaceId]
      );
      for (const row of rows) {
        if (
          query &&
          ![row.name, row.slug, row.description ?? ''].some(v => v.toLowerCase().includes(query))
        )
          continue;
        total++;
        if (projects.length >= limit) continue;
        if (!listed) {
          listed = true;
          assignmentCatalogs.push({
            workspace: grant.workspaceName,
            ...assignmentCatalogProjection(
              this.options.assignmentCatalog
                ? await this.options.assignmentCatalog(grant.workspaceId)
                : JSON.parse(
                    (
                      await this.options.db.get<{ settings_json: string }>(
                        'SELECT settings_json FROM workspaces WHERE id = ?',
                        [grant.workspaceId]
                      )
                    )?.settings_json ?? '{}'
                  ).agentCatalog
            )
          });
        }
        const resources = await listProjectResources({
          ctx: this.access.context(grant),
          projectId: row.id
        });
        projects.push({
          projectId: row.id,
          name: row.name,
          slug: row.slug,
          workspace: grant.workspaceName,
          description: clip(row.description, 400),
          launchPreference: await readProjectLaunchSelection(this.access.context(grant), row.id),
          resources: resources.map(r => ({
            resourceKey: r.resourceKey,
            label: r.label,
            type: r.type,
            isPrimary: r.isPrimary
          }))
        });
        sources.push(this.projectSource(row, observedAt));
      }
    }
    return {
      outcome: 'ok' as const,
      content: { projects, assignmentCatalogs, total, truncated: total > projects.length },
      sources
    };
  }

  private async listTargets(owner: ChatOwner, projectId: string): Promise<ChatToolOutput> {
    const scope = await this.access.projectGrant(owner, projectId);
    if (!scope) return failure('not_found', 'Project not found.');
    const selection = await getProjectExecutionTargetSelection({
      ctx: this.access.context(scope.grant),
      projectId
    });
    return {
      outcome: 'ok',
      content: {
        projectId,
        project: scope.project.name,
        targets: selection.eligibleTargets.map(t => ({
          executionTargetId: t.executionTargetId,
          label: t.label,
          device: t.deviceLabel,
          type: t.type,
          reachable: t.reachable,
          primaryResourceConnected: t.primaryResourceConnected,
          selected: t.executionTargetId === selection.selectedExecutionTargetId
        }))
      },
      sources: [this.projectSource(scope.project, this.now())]
    };
  }

  private async searchMissions(
    owner: ChatOwner,
    input: Record<string, unknown>
  ): Promise<ChatToolOutput> {
    const observedAt = this.now();
    const limit = Number(input.limit ?? 10);
    const projectId = typeof input.projectId === 'string' ? input.projectId : null;
    let grants: ChatWorkspaceGrant[];
    if (projectId) {
      const scope = await this.access.projectGrant(owner, projectId, PERMISSIONS.MISSION_READ);
      if (!scope) return failure('not_found', 'Project not found.');
      grants = [scope.grant];
    } else grants = await this.access.grants(owner, PERMISSIONS.MISSION_READ);
    const hits = [];
    for (const grant of grants) {
      const response = await searchMissionsV3({
        ctx: this.access.context(grant),
        query: String(input.query),
        projectId,
        statusTypes: Array.isArray(input.statusTypes) ? (input.statusTypes as string[]) : null,
        limit,
        matchesPerResult: 3
      });
      hits.push(...response.results);
    }
    hits.sort((a, b) => b.relevance - a.relevance || b.updatedAt.localeCompare(a.updatedAt));
    const results = hits.slice(0, limit);
    return {
      outcome: 'ok',
      content: {
        results: results.map(r => ({
          missionId: r.id,
          displayId: r.displayId,
          title: r.title,
          statusType: r.statusType,
          projectId: r.projectId,
          project: r.projectName,
          workspace: r.workspaceName,
          updatedAt: r.updatedAt,
          snippet: clip(r.snippet, 300),
          matches: r.matches.map(m => ({
            entityType: m.entityType,
            id: m.id,
            displayId: m.displayId,
            title: clip(m.title, 200),
            objectiveState: m.objectiveState,
            snippet: clip(m.snippet, 300)
          }))
        })),
        totalBeforeLimit: hits.length
      },
      sources: results.map(r => ({
        scopeKey: `overlord:mission:${r.id}`,
        locator: {
          kind: 'overlord',
          entityType: 'mission',
          entityId: r.id,
          projectId: r.projectId
        },
        label: `Mission ${r.displayId} ${clip(r.title, 120) ?? ''}`.trim(),
        excerpt: clip(r.snippet, EXCERPT_CHARS),
        truncated: false,
        revision: r.updatedAt,
        observedAt
      }))
    };
  }

  private async getMission(owner: ChatOwner, ref: string): Promise<ChatToolOutput> {
    const observedAt = this.now();
    const candidates = await this.options.db.all<{
      id: string;
      display_id: string;
      title: string;
      status_type: string;
      project_id: string;
      updated_at: string;
    }>(
      'SELECT id, display_id, title, status_type, project_id, updated_at FROM missions WHERE (id = ? OR display_id = ?) AND deleted_at IS NULL LIMIT 10',
      [ref, ref]
    );
    const visible: ((typeof candidates)[number] & { projectName: string })[] = [];
    for (const m of candidates) {
      const scope = await this.access.projectGrant(owner, m.project_id, PERMISSIONS.MISSION_READ);
      if (scope) visible.push({ ...m, projectName: scope.project.name });
    }
    if (!visible.length) return failure('not_found', 'Mission not found.');
    if (visible.length > 1)
      return {
        outcome: 'ok',
        content: {
          ambiguous: true,
          missions: visible.map(m => ({
            missionId: m.id,
            displayId: m.display_id,
            title: m.title,
            project: m.projectName
          }))
        },
        sources: []
      };
    const m = visible[0]!;
    const objectives = await this.options.db.all<{
      id: string;
      display_key: string | null;
      title: string | null;
      instruction_text: string;
      state: string;
      resource_key: string | null;
    }>(
      'SELECT id, display_key, title, instruction_text, state, resource_key FROM objectives WHERE mission_id = ? AND deleted_at IS NULL ORDER BY position LIMIT 30',
      [m.id]
    );
    const deliveries = await this.options.db.all<{
      id: string;
      objective_id: string;
      summary: string;
      delivered_at: string;
    }>(
      'SELECT id, objective_id, summary, delivered_at FROM deliveries WHERE mission_id = ? AND deleted_at IS NULL ORDER BY delivered_at DESC LIMIT 5',
      [m.id]
    );
    const sources: ChatToolSource[] = [
      {
        scopeKey: `overlord:mission:${m.id}`,
        locator: {
          kind: 'overlord',
          entityType: 'mission',
          entityId: m.id,
          projectId: m.project_id
        },
        label: `Mission ${m.display_id} ${clip(m.title, 120) ?? ''}`.trim(),
        excerpt: clip(m.title, EXCERPT_CHARS),
        truncated: false,
        revision: m.updated_at,
        observedAt
      },
      ...deliveries.map(d => ({
        scopeKey: `overlord:delivery:${d.id}`,
        locator: {
          kind: 'overlord' as const,
          entityType: 'delivery' as const,
          entityId: d.id,
          projectId: m.project_id
        },
        label: `Delivery on ${m.display_id} (${d.delivered_at.slice(0, 10)})`,
        excerpt: clip(d.summary, EXCERPT_CHARS),
        truncated: d.summary.length > EXCERPT_CHARS,
        revision: d.delivered_at,
        observedAt
      }))
    ];
    return {
      outcome: 'ok',
      content: {
        missionId: m.id,
        displayId: m.display_id,
        title: m.title,
        statusType: m.status_type,
        projectId: m.project_id,
        project: m.projectName,
        objectives: objectives.map(o => ({
          objectiveId: o.id,
          displayId: o.display_key ? `${m.display_id}.${o.display_key}` : null,
          title: o.title,
          state: o.state,
          resourceKey: o.resource_key,
          objective: clip(o.instruction_text, 1500)
        })),
        deliveries: deliveries.map(d => ({
          deliveryId: d.id,
          objectiveId: d.objective_id,
          deliveredAt: d.delivered_at,
          summary: clip(d.summary, 2000)
        }))
      },
      sources
    };
  }

  private async readRepository(
    owner: ChatOwner,
    runId: string,
    operationId: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<ChatToolOutput> {
    if (!this.options.readRepository) return failure('unknown_tool', 'No such read tool.');
    let request: RepositoryReadRequest;
    try {
      // The operation id is Overlord's, never the model's, so retries reuse it.
      request = parseRepositoryReadRequest({ ...input, operationId });
    } catch {
      return failure('invalid_arguments', 'Invalid repository read.');
    }
    const scope = await this.access.projectGrant(owner, request.projectId);
    if (!scope) return failure('not_found', 'Project not found.');
    let result: RepositoryReadResult;
    try {
      result = await this.options.readRepository({
        ctx: this.access.context(scope.grant),
        request,
        scopeKey: `chat-run:${runId}`,
        signal: signal ?? null
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      return status === 404
        ? failure('not_found', 'Execution target or resource not found.')
        : failure('unavailable', 'The repository read could not be completed.');
    }
    const relativePath =
      'relativePath' in request && typeof request.relativePath === 'string'
        ? request.relativePath
        : null;
    let data = result.data as Record<string, unknown> | null;
    let truncated = result.truncated;
    const json = JSON.stringify(data ?? null);
    if (Buffer.byteLength(json, 'utf8') > CHAT_TOOL_CONTENT_BYTES - 4096 && data) {
      data = { ...data };
      for (const key of ['diff', 'content'] as const)
        if (typeof data[key] === 'string') {
          const cut = cutUtf8(data[key], CHAT_TOOL_CONTENT_BYTES - 8192);
          data[key] = cut.text;
          truncated ||= cut.cut;
        }
      if (Buffer.byteLength(JSON.stringify(data), 'utf8') > CHAT_TOOL_CONTENT_BYTES - 4096) {
        data = { message: 'Result too large for one read; narrow the path or scope.' };
        truncated = true;
      }
    }
    const outcome: ChatToolOutcome =
      result.outcome === 'ok' || result.outcome === 'binary' || result.outcome === 'oversized'
        ? 'ok'
        : result.outcome === 'timeout' || result.outcome === 'target_offline'
          ? 'timeout'
          : result.outcome === 'denied'
            ? 'denied'
            : result.outcome === 'not_found'
              ? 'not_found'
              : 'unavailable';
    const content = {
      operation: result.operation,
      outcome: result.outcome,
      executionTargetId: request.executionTargetId,
      projectId: request.projectId,
      resourceKey: request.resourceKey,
      head: result.head,
      branch: result.branch,
      observedAt: result.observedAt,
      truncated,
      data
    };
    const excerptSource =
      typeof data?.diff === 'string'
        ? data.diff
        : typeof data?.content === 'string'
          ? data.content
          : JSON.stringify(data ?? '');
    // Failed reads observed nothing about the repository, so they cite nothing.
    const sources: ChatToolSource[] =
      result.outcome === 'ok' || result.outcome === 'binary' || result.outcome === 'oversized'
        ? [
            {
              scopeKey: `repository:${request.executionTargetId}:${request.projectId}:${request.resourceKey}:${relativePath ?? ''}@${result.head ?? 'none'}`,
              locator: {
                kind: 'repository',
                executionTargetId: request.executionTargetId,
                projectId: request.projectId,
                resourceKey: request.resourceKey,
                relativePath,
                head: result.head
              },
              label: `${scope.project.name}/${request.resourceKey} ${result.operation}${relativePath ? ` ${relativePath}` : ''}${result.head ? ` @ ${result.head.slice(0, 8)}` : ''}`,
              excerpt: clip(excerptSource, EXCERPT_CHARS),
              truncated: truncated || excerptSource.length > EXCERPT_CHARS,
              revision: result.head,
              observedAt: result.observedAt
            }
          ]
        : [];
    return { outcome, content, sources };
  }

  private async knowledgebase(
    owner: ChatOwner,
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<ChatToolOutput> {
    if (!this.options.knowledgebase) return failure('unknown_tool', 'No such read tool.');
    const result = await this.options.knowledgebase.call(owner, name, input, signal);
    if (result.outcome !== 'ok' && result.outcome !== 'tool_error') {
      const outcome: ChatToolOutcome =
        result.outcome === 'reauthorization_required' ||
        result.outcome === 'timeout' ||
        result.outcome === 'denied'
          ? result.outcome
          : result.outcome === 'invalid_arguments'
            ? 'invalid_arguments'
            : 'unavailable';
      return failure(outcome, result.detail ?? outcome);
    }
    const content = cutUtf8(result.text, CHAT_TOOL_CONTENT_BYTES - 4096);
    return {
      outcome: result.outcome === 'ok' ? 'ok' : 'tool_error',
      content: {
        workspace: result.workspace,
        text: content.text,
        truncated: result.truncated || content.cut
      },
      sources:
        result.outcome === 'ok'
          ? result.sources.map(s => ({
              scopeKey: `knowledgebase:${s.locator.connectionId}:${s.locator.workspace}:${s.locator.nodeId}`,
              locator: s.locator,
              label: `Knowledgebase ${s.locator.workspace}${s.locator.path ? `/${s.locator.path}` : ` node ${s.locator.nodeId.slice(0, 8)}`}`,
              excerpt: clip(result.text, EXCERPT_CHARS),
              truncated: result.text.length > EXCERPT_CHARS,
              revision: s.revision,
              observedAt: result.observedAt
            }))
          : []
    };
  }
}
