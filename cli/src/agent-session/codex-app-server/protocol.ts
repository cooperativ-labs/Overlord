/**
 * The pinned Codex app-server surface the `codex-app-server` adapter uses.
 *
 * `codex app-server` is labelled experimental, and 0.168–0.171 each changed its behavior. The
 * adapter therefore speaks only the methods and fields listed here, which were taken from the
 * bindings `codex app-server generate-ts --experimental` emits at the verified version
 * (0.170.0) and from recorded frames (`connectors/adapters/codex-app-server/fixtures/`). A test
 * pins these lists, so widening the surface is a reviewed change, not a drive-by.
 *
 * Wire facts this module encodes (plan `planning/feature-plans/codex-app-server-control-plane.md`):
 *  - JSON-RPC 2.0 without the `jsonrpc` field, one message per WebSocket text frame.
 *  - No protocol version field: the server version is the token after the first `/` in
 *    `initialize.userAgent`.
 *  - Approvals reach a client only when the thread's `approvalsReviewer` is `user`.
 */

import { compareSemver, parseSemver } from '../../semver.js';

/** Parse `codex-cli 0.170.0` (the `codex --version` line). */
export { parseSemver as parseCliVersion };

/** Lowest Codex version whose app-server behavior the adapter was verified against. */
export const CODEX_APP_SERVER_MIN_VERSION = '0.170.0';
/** The version the recorded fixtures come from. */
export const CODEX_APP_SERVER_VERIFIED_VERSION = '0.170.0';

export const CODEX_APP_SERVER_ADAPTER_KEY = 'codex-app-server';

/**
 * Set on the app server's environment by the supervisor. Every Overlord callback hook exits
 * before any work when it is present, so a harness Overlord drives through a control plane never
 * also reports through the hooks adapter (no double capture, no second decision path).
 */
export const CONTROL_PLANE_SURFACE_ENV = 'OVERLORD_CONTROL_PLANE_SURFACE';

/** Feature flag: the adapter refuses to run unless this is `1` until launch integration lands. */
export const CODEX_APP_SERVER_FLAG_ENV = 'OVERLORD_CODEX_APP_SERVER';

/**
 * Client → server requests the adapter may send. `thread/read` decides whether an unknown thread
 * is one of the session's subagents or forks; `thread/list {parentThreadId}` and
 * `thread/turns/list` import thread history after a resume (`history.ts`).
 */
export const PINNED_CLIENT_METHODS = [
  'initialize',
  'thread/start',
  'thread/resume',
  'thread/read',
  'thread/list',
  'thread/turns/list',
  'turn/start',
  'turn/steer',
  'turn/interrupt'
] as const;

/**
 * Read-only methods the one-shot model query (`cli/src/codex-models.ts`) sends to a short-lived
 * stdio app server. They never start a thread, so they write nothing to `~/.codex`.
 * `account/read` is asked only for the account type and plan; its email and account ids are
 * dropped at parse time and never stored or sent to Overlord.
 */
export const PINNED_QUERY_METHODS = [
  'initialize',
  'model/list',
  'modelProvider/list',
  'account/read'
] as const;

/** Client → server notifications the adapter may send. */
export const PINNED_CLIENT_NOTIFICATIONS = ['initialized'] as const;

/** Server → client requests the adapter answers with a decision. Everything else is refused. */
export const PINNED_SERVER_REQUESTS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/tool/requestUserInput'
] as const;

/** Server → client notifications the adapter reads. Unknown notifications are ignored. */
export const PINNED_NOTIFICATIONS = [
  'thread/started',
  'thread/status/changed',
  'thread/closed',
  'turn/started',
  'turn/completed',
  'item/started',
  'item/completed',
  'serverRequest/resolved',
  'remoteControl/status/changed',
  'error'
] as const;

/**
 * Experimental members the adapter may use. `experimentalApi: true` is sent so these are
 * delivered, but nothing outside this list may be depended on.
 */
export const EXPERIMENTAL_WHITELIST = ['item/tool/requestUserInput'] as const;

/**
 * High-volume notifications stopped at the source (`initialize.capabilities`). Streaming deltas
 * would carry model text and command output the adapter must never forward anyway.
 */
export const OPT_OUT_NOTIFICATION_METHODS = [
  'item/agentMessage/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'thread/tokenUsage/updated',
  'account/rateLimits/updated',
  'turn/moderationMetadata'
] as const;

export type PinnedClientMethod = (typeof PINNED_CLIENT_METHODS)[number];
export type PinnedServerRequest = (typeof PINNED_SERVER_REQUESTS)[number];

export const JSON_RPC_ERRORS = {
  invalidRequest: -32600,
  methodNotFound: -32601,
  /** Codex: the server is overloaded; retry with backoff. */
  overloaded: -32001
} as const;

export type ApprovalDecisionLiteral = 'accept' | 'acceptForSession' | 'decline' | 'cancel';
/** `availableDecisions` may also carry object decisions (policy amendments); never chosen. */
export type AvailableDecision = string | Record<string, unknown>;

export type CommandApprovalParams = {
  kind?: 'command' | 'humanCommand' | 'writeStdin' | string;
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId?: string | null;
  command?: string | null;
  cwd?: string | null;
  reason?: string | null;
  availableDecisions?: AvailableDecision[] | null;
};

export type FileChangeApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
};

export type UserInputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: { label: string; description: string }[] | null;
};

export type UserInputParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: UserInputQuestion[];
  isBlocking: boolean;
};

export type FileUpdateChange = {
  path: string;
  kind: { type: 'add' | 'delete' | 'update'; move_path?: string | null };
  diff?: string;
};

export type ThreadItem = { type: string; id: string; [key: string]: unknown };

export type ClientInfo = { name: string; title: string | null; version: string };

export function buildInitializeParams(clientVersion: string): {
  clientInfo: ClientInfo;
  capabilities: {
    experimentalApi: boolean;
    requestAttestation: boolean;
    optOutNotificationMethods: string[];
  };
} {
  return {
    clientInfo: { name: 'overlord', title: 'Overlord', version: clientVersion },
    capabilities: {
      // `requestUserInput` is experimental; nothing else experimental is used.
      experimentalApi: true,
      requestAttestation: false,
      optOutNotificationMethods: [...OPT_OUT_NOTIFICATION_METHODS]
    }
  };
}

/** Parse `<name>/<version> (...)` from `initialize.userAgent`. */
export function parseServerVersion(userAgent: unknown): string | null {
  if (typeof userAgent !== 'string') return null;
  const match = /^[^/\s]+\/(\d+\.\d+\.\d+)/.exec(userAgent.trim());
  return match?.[1] ?? null;
}

export function isSupportedVersion(version: string | null): boolean {
  return version !== null && compareSemver(version, CODEX_APP_SERVER_MIN_VERSION) >= 0;
}

/**
 * Thread settings every Overlord thread is started with.
 *
 * `approvalsReviewer: "user"` is an invariant, not a default: a user config with
 * `approvals_reviewer = "auto_review"` would otherwise let a Codex subagent decide approvals the
 * adapter never sees. The thread is persistent so it can be resumed and attached to.
 */
export function buildThreadStartParams({
  cwd,
  model,
  effort,
  approvalPolicy,
  sandbox,
  developerInstructions
}: {
  cwd: string;
  model?: string | null;
  effort?: string | null;
  approvalPolicy?: 'untrusted' | 'on-request' | 'never' | null;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
  developerInstructions?: string | null;
}): Record<string, unknown> {
  return {
    cwd,
    approvalsReviewer: 'user',
    approvalPolicy: approvalPolicy ?? 'on-request',
    sandbox: sandbox ?? 'workspace-write',
    ephemeral: false,
    ...(model ? { model } : {}),
    ...(effort ? { config: { model_reasoning_effort: effort } } : {}),
    ...(developerInstructions ? { developerInstructions } : {})
  };
}

export function textInput(text: string): { type: 'text'; text: string; text_elements: [] }[] {
  return [{ type: 'text', text, text_elements: [] }];
}
