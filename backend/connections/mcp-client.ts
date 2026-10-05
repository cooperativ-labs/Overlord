import type { ChatSourceLocatorDto } from '@overlord/contract';

import type { ChatOwner } from '../../packages/core/service/chat/store.ts';

import { EgressError, egressFetch, type FetchLike } from './egress.ts';
import {
  exposable,
  MAX_ARGUMENT_BYTES,
  namespacedToolId,
  parseToolId,
  reviewedTool,
  type ServerTool,
  validateArguments
} from './policy.ts';
import {
  type AccountConnections,
  ConnectionAccessError,
  connectionDto,
  type ConnectionRow
} from './service.ts';

/**
 * Backend outbound MCP client for the configured Knowledgebase (contract v152,
 * "Backend → Outbound MCP"). Streamable HTTP JSON-RPC to the configured origin
 * only; reviewed read tools only, namespaced per connection; argument, output,
 * and time bounds on every call; provenance on every result. Credentials come
 * only from the connections module and are never logged or returned.
 */
export interface KnowledgebaseToolDescriptor {
  /** Namespaced id the engine uses, e.g. `kb_0123456789ab_search`. */
  id: string;
  connectionId: string;
  tool: string;
  description: string;
  inputSchema: unknown;
}

export interface KnowledgebaseSource {
  locator: Extract<ChatSourceLocatorDto, { kind: 'knowledgebase' }>;
  /** Provider revision (`current_version_id`, `version_id`, or `revision`) when reported. */
  revision: string | null;
  updatedAt: string | null;
}

export type KnowledgebaseToolOutcome =
  | 'ok'
  | 'tool_error'
  | 'denied'
  | 'invalid_arguments'
  | 'timeout'
  | 'unavailable'
  | 'reauthorization_required';

export interface KnowledgebaseToolResult {
  toolId: string;
  connectionId: string | null;
  tool: string | null;
  workspace: string | null;
  outcome: KnowledgebaseToolOutcome;
  /** Bounded UTF-8 text for provider input; empty unless `ok` or `tool_error`. */
  text: string;
  bytes: number;
  truncated: boolean;
  /** HTTP status the Knowledgebase reported inside a tool error, when present. */
  upstreamStatus: number | null;
  sources: KnowledgebaseSource[];
  observedAt: string;
  /** Safe, non-content detail for logs and model feedback. */
  detail: string | null;
}

export const KNOWLEDGEBASE_BOUNDS = {
  /** Text returned to the engine per call. */
  outputBytes: 64 * 1024,
  /** Raw response bytes read from the network (wire framing included). */
  responseBytes: 1024 * 1024,
  callTimeoutMs: 15_000,
  toolsTtlMs: 5 * 60 * 1000,
  maxSources: 50
} as const;

const PROTOCOL_VERSION = '2025-06-18';

class UpstreamUnauthorized extends Error {}
class UpstreamUnavailable extends Error {
  constructor(readonly timeout: boolean) {
    super('unavailable');
  }
}

interface RpcResponse {
  result: Record<string, unknown> | null;
  error: unknown;
  truncated: boolean;
  bytes: number;
  rawText: string;
}

export class KnowledgebaseMcp {
  private readonly sessions = new Map<string, string | null>();
  private readonly toolCache = new Map<string, { at: number; tools: ServerTool[] }>();
  private rpcId = 0;
  constructor(
    private readonly options: {
      mcpUrl: string;
      egressOrigins: readonly string[];
      connections: AccountConnections;
      fetch: FetchLike;
      now?: () => number;
      bounds?: Partial<typeof KNOWLEDGEBASE_BOUNDS>;
    }
  ) {}

  private get bounds() {
    return { ...KNOWLEDGEBASE_BOUNDS, ...this.options.bounds };
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private async post(
    token: string,
    session: string | null,
    body: unknown,
    signal?: AbortSignal
  ): Promise<{
    status: number;
    text: string;
    truncated: boolean;
    bytes: number;
    session: string | null;
  }> {
    try {
      const response = await egressFetch(
        this.options.fetch,
        this.options.egressOrigins,
        this.options.mcpUrl,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${token}`,
            'mcp-protocol-version': PROTOCOL_VERSION,
            ...(session ? { 'mcp-session-id': session } : {})
          },
          body: JSON.stringify(body)
        },
        { timeoutMs: this.bounds.callTimeoutMs, maxBytes: this.bounds.responseBytes, signal }
      );
      if (response.status === 401) throw new UpstreamUnauthorized();
      return {
        status: response.status,
        text: response.text,
        truncated: response.truncated,
        bytes: response.bytes,
        session: response.headers.get('mcp-session-id')
      };
    } catch (error) {
      if (error instanceof UpstreamUnauthorized) throw error;
      throw new UpstreamUnavailable(error instanceof EgressError && error.code === 'timeout');
    }
  }

  /** One JSON-RPC exchange; parses a JSON body or the matching SSE `data:` message. */
  private async rpc(
    token: string,
    connectionKey: string,
    method: string,
    params: unknown,
    signal?: AbortSignal
  ): Promise<RpcResponse> {
    let session = await this.session(token, connectionKey, signal);
    for (let attempt = 0; ; attempt++) {
      const id = ++this.rpcId;
      const response = await this.post(
        token,
        session,
        { jsonrpc: '2.0', id, method, params },
        signal
      );
      if (response.status === 404 && session && attempt === 0) {
        // The server dropped the session; start a new one once.
        this.sessions.delete(connectionKey);
        session = await this.session(token, connectionKey, signal);
        continue;
      }
      if (response.status !== 200) throw new UpstreamUnavailable(false);
      const message = parseRpcMessage(response.text, id);
      return {
        result:
          message?.result && typeof message.result === 'object'
            ? (message.result as Record<string, unknown>)
            : null,
        error: message?.error ?? (message ? null : 'unparseable'),
        truncated: response.truncated,
        bytes: response.bytes,
        rawText: response.text
      };
    }
  }

  private async session(token: string, connectionKey: string, signal?: AbortSignal) {
    if (this.sessions.has(connectionKey)) return this.sessions.get(connectionKey)!;
    const id = ++this.rpcId;
    const init = await this.post(
      token,
      null,
      {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'overlord-assistant', version: '1' }
        }
      },
      signal
    );
    if (init.status !== 200 || !parseRpcMessage(init.text, id)?.result)
      throw new UpstreamUnavailable(false);
    await this.post(
      token,
      init.session,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      signal
    );
    const connection = connectionKey.split(':')[0];
    for (const key of this.sessions.keys())
      if (key.split(':')[0] === connection) this.sessions.delete(key);
    this.sessions.set(connectionKey, init.session);
    return init.session;
  }

  /**
   * Runs `fn` with a current token. A 401 triggers one coalesced refresh; a second
   * 401 means the grant was revoked and the connection requires reauthorization.
   */
  private async authorized<T>(
    owner: ChatOwner,
    connectionId: string,
    fn: (token: string, connectionKey: string) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    let token = await this.options.connections.accessToken(owner, connectionId, { signal });
    for (let attempt = 0; ; attempt++) {
      const key = `${connectionId}:${token.credentialRevision}`;
      try {
        return await fn(token.accessToken, key);
      } catch (error) {
        if (!(error instanceof UpstreamUnauthorized)) throw error;
        this.sessions.delete(key);
        if (attempt > 0) {
          await this.options.connections.requireReauthorization(
            connectionId,
            'upstream_unauthorized'
          );
          throw new ConnectionAccessError('reauthorization_required');
        }
        token = await this.options.connections.accessToken(owner, connectionId, {
          staleRevision: token.credentialRevision,
          signal
        });
      }
    }
  }

  /** Workspaces visible to a token; used by the connections module right after sign-in. */
  async listWorkspacesWithToken(accessToken: string): Promise<string[] | null> {
    const key = `signin-${++this.rpcId}:0`;
    try {
      const response = await this.rpc(accessToken, key, 'tools/call', {
        name: 'list_workspaces',
        arguments: {}
      });
      return workspacesFrom(toolText(response.result));
    } catch {
      return null;
    } finally {
      this.sessions.delete(key);
    }
  }

  private async serverTools(owner: ChatOwner, row: ConnectionRow, signal?: AbortSignal) {
    const cached = this.toolCache.get(row.id!);
    if (cached && this.now() - cached.at < this.bounds.toolsTtlMs) return cached.tools;
    const tools = await this.authorized(
      owner,
      row.id!,
      async (token, key) => {
        const response = await this.rpc(token, key, 'tools/list', {}, signal);
        const list = response.result?.tools;
        if (!Array.isArray(list)) throw new UpstreamUnavailable(false);
        return list
          .filter((t): t is ServerTool => Boolean(t) && typeof t.name === 'string')
          .map(t => ({ name: t.name, annotations: t.annotations ?? null }));
      },
      signal
    );
    this.toolCache.set(row.id!, { at: this.now(), tools });
    return tools;
  }

  /** The reviewed, server-confirmed read tools for every connected Knowledgebase grant. */
  async tools(owner: ChatOwner, signal?: AbortSignal): Promise<KnowledgebaseToolDescriptor[]> {
    const out: KnowledgebaseToolDescriptor[] = [];
    for (const row of await this.options.connections.liveRows(owner, 'knowledgebase')) {
      if (row.state !== 'connected' || row.server_url !== this.options.mcpUrl) continue;
      let tools: ServerTool[];
      try {
        tools = await this.serverTools(owner, row, signal);
      } catch {
        continue; // An unavailable connection contributes no tools; readiness reports why.
      }
      for (const server of tools) {
        const reviewed = exposable(server);
        if (!reviewed) continue;
        out.push({
          id: namespacedToolId(row.id!, reviewed.name),
          connectionId: row.id!,
          tool: reviewed.name,
          description: reviewed.description,
          inputSchema: reviewed.inputSchema
        });
      }
    }
    return out;
  }

  private async resolve(owner: ChatOwner, toolId: string) {
    const parsed = parseToolId(toolId);
    if (!parsed) return null;
    const matches = (await this.options.connections.liveRows(owner, 'knowledgebase')).filter(row =>
      row.id!.replaceAll('-', '').startsWith(parsed.connectionPrefix)
    );
    return matches.length === 1 ? { row: matches[0]!, tool: parsed.tool } : null;
  }

  async call(
    owner: ChatOwner,
    toolId: string,
    args: unknown,
    signal?: AbortSignal
  ): Promise<KnowledgebaseToolResult> {
    const observedAt = new Date(this.now()).toISOString();
    const base: KnowledgebaseToolResult = {
      toolId,
      connectionId: null,
      tool: null,
      workspace: null,
      outcome: 'denied',
      text: '',
      bytes: 0,
      truncated: false,
      upstreamStatus: null,
      sources: [],
      observedAt,
      detail: null
    };
    const resolved = await this.resolve(owner, toolId);
    if (!resolved) return { ...base, detail: 'unknown_tool' };
    const { row, tool } = resolved;
    base.connectionId = row.id!;
    base.tool = tool;
    // Writes and unreviewed tools are rejected by name, whatever the server annotates.
    const reviewed = reviewedTool(tool);
    if (!reviewed) return { ...base, detail: 'not_in_read_allowlist' };
    if (row.state !== 'connected')
      return { ...base, outcome: 'reauthorization_required', detail: 'connection_not_ready' };
    if (JSON.stringify(args ?? null).length > MAX_ARGUMENT_BYTES)
      return { ...base, outcome: 'invalid_arguments', detail: 'arguments_too_large' };
    const invalid = validateArguments(reviewed.inputSchema, args);
    if (invalid) return { ...base, outcome: 'invalid_arguments', detail: invalid };
    const input = args as Record<string, unknown>;
    const workspace = typeof input.workspace === 'string' ? input.workspace : null;
    base.workspace = workspace;
    try {
      if (workspace && !(await this.workspaceAuthorized(owner, row, workspace, signal)))
        return { ...base, detail: 'workspace_not_authorized' };
      const server = (await this.serverTools(owner, row, signal)).find(t => t.name === tool);
      if (!server || !exposable(server))
        return { ...base, detail: 'withheld_by_server_annotations' };
      const response = await this.authorized(
        owner,
        row.id!,
        (token, key) =>
          this.rpc(token, key, 'tools/call', { name: tool, arguments: input }, signal),
        signal
      );
      if (response.truncated)
        return { ...base, outcome: 'tool_error', truncated: true, detail: 'response_too_large' };
      if (!response.result) return { ...base, outcome: 'unavailable', detail: 'protocol_error' };
      const fullText = toolText(response.result);
      const isError = response.result.isError === true;
      const limit = this.bounds.outputBytes;
      const fullBytes = Buffer.byteLength(fullText, 'utf8');
      const text = fullBytes > limit ? truncateUtf8(fullText, limit) : fullText;
      if (tool === 'list_workspaces' && !isError) {
        const workspaces = workspacesFrom(fullText);
        if (workspaces) await this.options.connections.setAuthorizedWorkspaces(row.id!, workspaces);
      }
      return {
        ...base,
        outcome: isError ? 'tool_error' : 'ok',
        text,
        bytes: Buffer.byteLength(text, 'utf8'),
        truncated: fullBytes > limit,
        upstreamStatus: isError ? upstreamStatus(fullText) : null,
        sources: isError ? [] : provenance(fullText, row.id!, workspace, this.bounds.maxSources),
        detail: null
      };
    } catch (error) {
      if (error instanceof ConnectionAccessError)
        return {
          ...base,
          outcome: error.code === 'unavailable' ? 'unavailable' : 'reauthorization_required',
          detail: error.code
        };
      if (error instanceof UpstreamUnavailable)
        return {
          ...base,
          outcome: error.timeout ? 'timeout' : 'unavailable',
          detail: 'upstream_unavailable'
        };
      return { ...base, outcome: 'unavailable', detail: 'unexpected' };
    }
  }

  private async workspaceAuthorized(
    owner: ChatOwner,
    row: ConnectionRow,
    workspace: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (connectionDto(row).authorizedWorkspaces.includes(workspace)) return true;
    // A workspace shared since sign-in: refresh the recorded list once, then decide.
    const refreshed = await this.authorized(
      owner,
      row.id!,
      async (token, key) =>
        workspacesFrom(
          toolText(
            (
              await this.rpc(
                token,
                key,
                'tools/call',
                { name: 'list_workspaces', arguments: {} },
                signal
              )
            ).result
          )
        ),
      signal
    );
    if (!refreshed) return false;
    await this.options.connections.setAuthorizedWorkspaces(row.id!, refreshed);
    return refreshed.includes(workspace);
  }

  /**
   * Current per-source access check: `get_related(node_id)`, which the server answers
   * from `GET /v1/ws/{ws}/nodes/{id}` (403 once access is revoked). Anything that is not
   * a positive answer is `revoked` (explicit denial) or `unknown`; both fail closed.
   */
  async checkNode(
    owner: ChatOwner,
    locator: Extract<ChatSourceLocatorDto, { kind: 'knowledgebase' }>,
    signal?: AbortSignal
  ): Promise<'authorized' | 'revoked' | 'unknown'> {
    const row = await this.options.connections.row(owner, locator.connectionId);
    if (!row || row.state === 'disconnected' || row.provider !== 'knowledgebase') return 'revoked';
    if (row.state !== 'connected') return 'unknown';
    const result = await this.call(
      owner,
      namespacedToolId(row.id!, 'get_related'),
      { workspace: locator.workspace, node_id: locator.nodeId },
      signal
    );
    if (result.outcome === 'ok') return 'authorized';
    if (
      result.outcome === 'tool_error' &&
      (result.upstreamStatus === 403 || result.upstreamStatus === 404)
    )
      return 'revoked';
    if (result.outcome === 'denied' && result.detail === 'workspace_not_authorized')
      return 'revoked';
    return 'unknown';
  }
}

export function parseRpcMessage(text: string, id: number): Record<string, unknown> | null {
  const candidates: string[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) candidates.push(trimmed);
  else
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n');
      if (data) candidates.push(data);
    }
  for (const candidate of candidates) {
    try {
      const message = JSON.parse(candidate) as Record<string, unknown>;
      if (message && message.id === id) return message;
    } catch {
      /* skip non-JSON frames */
    }
  }
  return null;
}

function toolText(result: Record<string, unknown> | null): string {
  const content = result?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map(item =>
      item && typeof item === 'object' && (item as { type?: unknown }).type === 'text'
        ? String((item as { text?: unknown }).text ?? '')
        : ''
    )
    .join('');
}

function truncateUtf8(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8').subarray(0, maxBytes);
  // Drop a trailing partial code point.
  return buffer.toString('utf8').replace(/�$/, '');
}

function upstreamStatus(text: string): number | null {
  const match = /\(HTTP (\d{3})\)/.exec(text) ?? /"status"\s*:\s*(\d{3})/.exec(text);
  return match ? Number(match[1]) : null;
}

function workspacesFrom(text: string): string[] | null {
  try {
    const parsed = JSON.parse(text) as { workspaces?: unknown };
    if (!Array.isArray(parsed.workspaces)) return null;
    return parsed.workspaces
      .map(w => (w && typeof w === 'object' ? (w as { slug?: unknown }).slug : w))
      .filter(
        (slug): slug is string => typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)
      );
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Source provenance: every node-shaped object (a UUID `id`/`node_id`, with optional
 * `path`, version, and `updated_at`) in the full response, deduplicated and bounded.
 * The workspace is the one the call was scoped to.
 */
export function provenance(
  text: string,
  connectionId: string,
  workspace: string | null,
  maxSources: number
): KnowledgebaseSource[] {
  if (!workspace) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const out = new Map<string, KnowledgebaseSource>();
  let visited = 0;
  const visit = (value: unknown, depth: number) => {
    if (out.size >= maxSources || depth > 8 || ++visited > 5000) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const id = [record.node_id, record.id].find(v => typeof v === 'string' && UUID.test(v)) as
      | string
      | undefined;
    if (
      id &&
      !out.has(id) &&
      (typeof record.path === 'string' || 'current_version_id' in record || 'title' in record)
    ) {
      const revision = [
        record.current_version_id,
        record.version_id,
        record.expected_version,
        record.expectedVersion,
        record.revision
      ].find(v => typeof v === 'string' || typeof v === 'number');
      out.set(id, {
        locator: {
          kind: 'knowledgebase',
          connectionId,
          workspace,
          nodeId: id,
          path: typeof record.path === 'string' ? record.path.slice(0, 512) : null
        },
        revision: revision === undefined ? null : String(revision),
        updatedAt: typeof record.updated_at === 'string' ? record.updated_at : null
      });
    }
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(parsed, 0);
  return [...out.values()];
}
