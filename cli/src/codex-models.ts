import { type ChildProcess, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildInitializeParams,
  parseServerVersion
} from './agent-session/codex-app-server/protocol.js';
import { JsonRpcPeer, RpcError } from './agent-session/codex-app-server/rpc.js';
import { buildServerEnv } from './agent-session/codex-app-server/server.js';
import { createLineTransport } from './agent-session/codex-app-server/transport.js';
import { BUNDLED_AGENT_CATALOG } from './agent-catalog-defaults.js';
import type { BackendClient } from './backend-client.js';
import { resolveGlobalDataDir } from './config.js';
import { asRecord } from './records.js';

/**
 * Live Codex models, providers and reasoning efforts, read from the user's own Codex
 * installation through a short-lived `codex app-server` over stdio (plan
 * `planning/feature-plans/codex-app-server-control-plane.md` §3.7, §9 item 6).
 *
 * - **Read only.** Only `PINNED_QUERY_METHODS` are sent; no thread is started, so nothing is
 *   written to `~/.codex`.
 * - **Account identifiers stay on this machine.** `account/read` returns the ChatGPT email and
 *   account ids; only the account type and plan are kept (`parseAccountSummary`), they are shown
 *   locally and never cached or reported to Overlord.
 * - **Fallback.** When Codex is missing, too old for these methods, or does not answer, the
 *   caller gets `null` and uses the bundled catalog (`agent-catalog-defaults.ts`); launch
 *   validation is then skipped rather than guessed.
 */

export type CodexLiveModel = {
  id: string;
  displayName: string;
  description: string | null;
  reasoningOptions: string[];
  defaultReasoningEffort: string | null;
  isDefault: boolean;
};

export type CodexLiveProvider = { id: string; name: string };

export type CodexAccountSummary = {
  type: string | null;
  planType: string | null;
  requiresOpenaiAuth: boolean;
};

export type CodexLiveModels = {
  source: 'live';
  codexVersion: string | null;
  /** The provider the list is for; `null` means Codex's default provider. */
  provider: string | null;
  models: CodexLiveModel[];
  providers: CodexLiveProvider[];
  defaultProviderId: string | null;
  fetchedAt: string;
};

/** Never more pages than this: a misbehaving server must not keep the query alive. */
const MAX_MODEL_PAGES = 10;
const QUERY_TIMEOUT_MS = 15_000;

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Map one `model/list` page entry; hidden models and entries without an id are dropped. */
export function parseCodexModel(raw: unknown): CodexLiveModel | null {
  const model = asRecord(raw);
  if (model.hidden === true) return null;
  // `model` is the slug Codex accepts as `--model`; `id` has matched it on every observed
  // release, but the slug is what a launch passes.
  const id = stringOrNull(model.model) ?? stringOrNull(model.id);
  if (!id) return null;
  const efforts = Array.isArray(model.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
        .map(entry =>
          typeof entry === 'string' ? entry.trim() : stringOrNull(asRecord(entry).reasoningEffort)
        )
        .filter((effort): effort is string => Boolean(effort))
    : [];
  const reasoningOptions = Array.from(new Set(efforts));
  const defaultEffort = stringOrNull(model.defaultReasoningEffort);
  return {
    id,
    displayName: stringOrNull(model.displayName) ?? id,
    description: stringOrNull(model.description),
    reasoningOptions,
    defaultReasoningEffort:
      defaultEffort && (reasoningOptions.length === 0 || reasoningOptions.includes(defaultEffort))
        ? defaultEffort
        : null,
    isDefault: model.isDefault === true
  };
}

export function parseCodexModelPages(pages: unknown[]): CodexLiveModel[] {
  const byId = new Map<string, CodexLiveModel>();
  for (const page of pages) {
    const data = asRecord(page).data;
    if (!Array.isArray(data)) continue;
    for (const entry of data) {
      const model = parseCodexModel(entry);
      if (model && !byId.has(model.id)) byId.set(model.id, model);
    }
  }
  return Array.from(byId.values());
}

export function parseCodexProviders(raw: unknown): {
  providers: CodexLiveProvider[];
  defaultProviderId: string | null;
} {
  const record = asRecord(raw);
  const providers = (Array.isArray(record.data) ? record.data : [])
    .map(entry => {
      const provider = asRecord(entry);
      const id = stringOrNull(provider.id);
      // `baseUrl` and `settings` are deliberately not kept: they can carry a private endpoint.
      return id ? { id, name: stringOrNull(provider.name) ?? id } : null;
    })
    .filter((provider): provider is CodexLiveProvider => provider !== null);
  return { providers, defaultProviderId: stringOrNull(record.defaultProviderId) };
}

/**
 * Keep only the account type and plan from `account/read`. The email, ChatGPT user id, account
 * id and workspace name are personal identifiers (plan §3.7) and are dropped here, so nothing
 * downstream can store or send them.
 */
export function parseAccountSummary(raw: unknown): CodexAccountSummary {
  const record = asRecord(raw);
  const account = asRecord(record.account);
  return {
    type: stringOrNull(account.type),
    planType: stringOrNull(account.planType),
    requiresOpenaiAuth: record.requiresOpenaiAuth === true
  };
}

export type CodexQueryResult =
  | { ok: true; live: CodexLiveModels; account: CodexAccountSummary | null }
  | { ok: false; reason: string };

/**
 * Ask a short-lived `codex app-server` (stdio) for its models, providers and account summary.
 * Never throws: every failure is a `{ ok: false, reason }` the caller turns into a fallback.
 */
export async function queryCodexLiveModels({
  codexBin = 'codex',
  cwd = process.cwd(),
  env = process.env,
  provider = null,
  includeAccount = false,
  clientVersion = '0.0.0',
  timeoutMs = QUERY_TIMEOUT_MS,
  spawnImpl = spawn,
  now = () => new Date()
}: {
  codexBin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  provider?: string | null;
  includeAccount?: boolean;
  clientVersion?: string;
  timeoutMs?: number;
  spawnImpl?: typeof spawn;
  now?: () => Date;
} = {}): Promise<CodexQueryResult> {
  let child: ChildProcess;
  try {
    child = spawnImpl(codexBin, ['app-server'], {
      cwd,
      env: buildServerEnv(env),
      stdio: ['pipe', 'pipe', 'ignore']
    });
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
  const spawnFailure = new Promise<CodexQueryResult>(resolve => {
    child.once('error', error => resolve({ ok: false, reason: errorMessage(error) }));
    child.once('exit', code =>
      resolve({ ok: false, reason: `codex app-server exited (${code ?? 'signal'})` })
    );
  });
  if (!child.stdout || !child.stdin) {
    child.kill();
    return { ok: false, reason: 'codex app-server has no stdio' };
  }
  // A closed stdin must not crash the CLI with EPIPE.
  child.stdin.on('error', () => undefined);
  const peer = new JsonRpcPeer(createLineTransport({ input: child.stdout, output: child.stdin }), {
    requestTimeoutMs: timeoutMs
  });
  const query = async (): Promise<CodexQueryResult> => {
    const init = asRecord(
      await peer.request('initialize', {
        ...buildInitializeParams(clientVersion),
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
          optOutNotificationMethods: []
        }
      })
    );
    peer.notify('initialized');
    const codexVersion = parseServerVersion(init.userAgent);

    const pages: unknown[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
      const result: unknown = await peer.request('model/list', {
        ...(provider ? { modelProvider: provider } : {}),
        ...(cursor ? { cursor } : {}),
        includeHidden: false
      });
      pages.push(result);
      cursor = stringOrNull(asRecord(result).nextCursor);
      if (!cursor) break;
    }

    // Provider discovery arrived in 0.168; an older server answers method-not-found, which is
    // not a reason to throw the model list away.
    let providers: ReturnType<typeof parseCodexProviders> = {
      providers: [],
      defaultProviderId: null
    };
    try {
      providers = parseCodexProviders(await peer.request('modelProvider/list', {}));
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
    }

    let account: CodexAccountSummary | null = null;
    if (includeAccount) {
      try {
        account = parseAccountSummary(await peer.request('account/read', {}));
      } catch (error) {
        if (!(error instanceof RpcError)) throw error;
      }
    }

    return {
      ok: true,
      live: {
        source: 'live',
        codexVersion,
        provider,
        models: parseCodexModelPages(pages),
        ...providers,
        fetchedAt: now().toISOString()
      },
      account
    };
  };

  try {
    const result = await Promise.race([
      query().catch(
        (error): CodexQueryResult => ({ ok: false, reason: describeQueryError(error) })
      ),
      spawnFailure
    ]);
    if (result.ok && result.live.models.length === 0) {
      return { ok: false, reason: 'codex app-server listed no models' };
    }
    return result;
  } finally {
    peer.close();
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeQueryError(error: unknown): string {
  if (error instanceof RpcError) {
    const type = stringOrNull(asRecord(error.data).type);
    return type ? `${error.message} (${type})` : error.message;
  }
  return errorMessage(error);
}

// ── Local cache ──────────────────────────────────────────────────────────────

/** How long a live list is trusted for launch validation before Codex is asked again. */
export const CODEX_MODELS_CACHE_TTL_MS = 10 * 60 * 1000;

export function codexModelsCachePath(dataDir: string = resolveGlobalDataDir()): string {
  return path.join(dataDir, 'cache', 'codex-models.json');
}

export function readCodexModelsCache({
  cachePath = codexModelsCachePath(),
  provider = null,
  maxAgeMs = CODEX_MODELS_CACHE_TTL_MS,
  now = () => new Date()
}: {
  cachePath?: string;
  provider?: string | null;
  maxAgeMs?: number;
  now?: () => Date;
} = {}): CodexLiveModels | null {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as CodexLiveModels;
    if (parsed?.source !== 'live' || !Array.isArray(parsed.models)) return null;
    if ((parsed.provider ?? null) !== (provider ?? null)) return null;
    const age = now().getTime() - Date.parse(parsed.fetchedAt);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Owner-only, written atomically. Holds no account data. */
export function writeCodexModelsCache(
  live: CodexLiveModels,
  cachePath: string = codexModelsCachePath()
): void {
  try {
    mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    const tmp = `${cachePath}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(live, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, cachePath);
  } catch {
    // A cache that cannot be written only costs a slower next query.
  }
}

/**
 * The live list, from the cache when it is fresh, otherwise from Codex (and then cached).
 * `null` when Codex cannot be asked; callers fall back to the bundled catalog.
 */
export async function loadCodexLiveModels({
  refresh = false,
  cachePath,
  query = queryCodexLiveModels,
  ...queryOptions
}: {
  refresh?: boolean;
  cachePath?: string;
  query?: typeof queryCodexLiveModels;
} & Parameters<typeof queryCodexLiveModels>[0] = {}): Promise<CodexLiveModels | null> {
  const provider = queryOptions.provider ?? null;
  if (!refresh) {
    const cached = readCodexModelsCache({ ...(cachePath ? { cachePath } : {}), provider });
    if (cached) return cached;
  }
  const result = await query({ ...queryOptions, includeAccount: false });
  if (!result.ok) return null;
  writeCodexModelsCache(result.live, cachePath);
  return result.live;
}

// ── Fallback and launch validation ──────────────────────────────────────────

/** The bundled Codex models, shaped like a live list, for when no server is reachable. */
export function bundledCodexModels(): CodexLiveModel[] {
  const codex = BUNDLED_AGENT_CATALOG.codex;
  if (!codex) return [];
  return codex.models.map(model => ({
    id: model.id,
    displayName: model.displayName,
    description: null,
    reasoningOptions: [...model.reasoningOptions],
    defaultReasoningEffort: model.id === codex.defaultModel ? codex.defaultReasoningEffort : null,
    isDefault: model.id === codex.defaultModel
  }));
}

export type CodexSelectionCheck = { ok: true } | { ok: false; message: string };

/**
 * Check a launch's Codex model and effort against the live list, so an unsupported pick is a
 * clear error before anything starts rather than a Codex failure in a terminal. A launch without
 * a model uses Codex's own default, so only the effort is checked against that default model.
 */
export function checkCodexLaunchSelection({
  live,
  model,
  effort
}: {
  live: CodexLiveModels;
  model?: string | null;
  effort?: string | null;
}): CodexSelectionCheck {
  const version = live.codexVersion ? `Codex ${live.codexVersion}` : 'your Codex installation';
  const modelId = model?.trim() || null;
  const effortId = effort?.trim() || null;
  const chosen = modelId
    ? live.models.find(entry => entry.id === modelId)
    : live.models.find(entry => entry.isDefault);
  if (modelId && !chosen) {
    return {
      ok: false,
      message:
        `Codex model "${modelId}" is not available in ${version} on this machine. ` +
        `Available models: ${live.models.map(entry => entry.id).join(', ')}. ` +
        'Choose one of these for the objective, or run `ovld models codex --sync` to update ' +
        "the workspace's model picker."
    };
  }
  if (
    effortId &&
    chosen &&
    chosen.reasoningOptions.length > 0 &&
    !chosen.reasoningOptions.includes(effortId)
  ) {
    return {
      ok: false,
      message:
        `Codex model "${chosen.id}" does not support reasoning effort "${effortId}" in ${version}. ` +
        `Supported efforts: ${chosen.reasoningOptions.join(', ')}.`
    };
  }
  return { ok: true };
}

// ── Reporting to Overlord ───────────────────────────────────────────────────

export type AgentLiveModelsReportBody = {
  agent: string;
  harnessVersion: string | null;
  models: Array<{
    id: string;
    displayName: string;
    reasoningOptions: string[];
    isDefault: boolean;
    defaultReasoningEffort: string | null;
  }>;
};

/** The report body: models and efforts only. No provider endpoints, no account data. */
export function codexLiveModelsReportBody(live: CodexLiveModels): AgentLiveModelsReportBody {
  return {
    agent: 'codex',
    harnessVersion: live.codexVersion,
    models: live.models.map(model => ({
      id: model.id,
      displayName: model.displayName,
      reasoningOptions: [...model.reasoningOptions],
      isDefault: model.isDefault,
      defaultReasoningEffort: model.defaultReasoningEffort
    }))
  };
}

export function liveModelsReportPath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-catalog/live-models`;
}

export async function reportCodexLiveModels({
  backend,
  workspaceId,
  live
}: {
  backend: Pick<BackendClient, 'post'>;
  workspaceId: string;
  live: CodexLiveModels;
}): Promise<unknown> {
  return backend.post({
    path: liveModelsReportPath(workspaceId),
    body: codexLiveModelsReportBody(live)
  });
}

/** How often a long-running runner re-reports its Codex models. */
export const RUNNER_CODEX_MODELS_REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Throttled, never-throwing report for the runner loop: at start and then every
 * `RUNNER_CODEX_MODELS_REPORT_INTERVAL_MS`. A 403 (the runner's user lacks
 * `launch:configure`) stops further attempts for this process; launch validation still uses the
 * local list.
 */
export function createRunnerCodexModelsReporter({
  backend,
  resolveWorkspaceId,
  load = () => loadCodexLiveModels({ refresh: true }),
  intervalMs = RUNNER_CODEX_MODELS_REPORT_INTERVAL_MS,
  now = () => Date.now(),
  log = (message: string) => console.error(message)
}: {
  backend: Pick<BackendClient, 'post'>;
  resolveWorkspaceId: () => Promise<string | null>;
  load?: () => Promise<CodexLiveModels | null>;
  intervalMs?: number;
  now?: () => number;
  log?: (message: string) => void;
}): { tick: () => Promise<void> } {
  let lastAttemptAt: number | null = null;
  let disabled = false;
  let running = false;
  return {
    tick: async () => {
      if (disabled || running) return;
      if (lastAttemptAt !== null && now() - lastAttemptAt < intervalMs) return;
      running = true;
      lastAttemptAt = now();
      try {
        const live = await load();
        if (!live) return;
        const workspaceId = await resolveWorkspaceId();
        if (!workspaceId) return;
        await reportCodexLiveModels({ backend, workspaceId, live });
      } catch (error) {
        const status = asRecord(error).status;
        if (status === 403 || status === 404) {
          disabled = true;
          log(
            '[overlord] Not reporting Codex models to the workspace model picker: ' +
              'this account needs launch:configure there. Launches still check models locally.'
          );
          return;
        }
        log(`[overlord] Could not report Codex models: ${errorMessage(error)}`);
      } finally {
        running = false;
      }
    }
  };
}
