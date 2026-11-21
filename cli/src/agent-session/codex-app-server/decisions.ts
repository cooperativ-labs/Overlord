import { describe } from '@overlord/core/service/agent-session/pure/describe/index';
import { FORMATTER_VERSION } from '@overlord/core/service/agent-session/pure/describe/types';
import { summarizeDescription } from '@overlord/core/service/agent-session/pure/envelope';
import { reduceEvidencePath } from '@overlord/core/service/agent-session/pure/evidence-path';
import { safeText } from '@overlord/core/service/agent-session/pure/text';

import type { ChannelClient } from '../client.js';

import type { ThreadTracker } from './events.js';
import type {
  AvailableDecision,
  CommandApprovalParams,
  FileChangeApprovalParams,
  UserInputParams
} from './protocol.js';
import { NoResponse, type RpcId } from './rpc.js';

/**
 * Codex approvals and questions → Overlord requests → the exact Codex answer.
 *
 * Codex sends an approval as a JSON-RPC request to every subscribed client and takes the first
 * answer (`serverRequest/resolved` tells the others). So Overlord is one answerer among several:
 * a person at an attached TUI can answer first, and when that happens the Overlord card is closed
 * as `resolved-elsewhere` instead of pretending the remote answer still applies.
 *
 * Rules that are security properties, not style:
 *  - **The decision mapping reads `availableDecisions`.** Under `approvalPolicy: "untrusted"`
 *    Codex may offer `cancel` but not `decline`, so a deny is `decline` only when offered.
 *  - **Never a standing grant.** `acceptForSession` and policy amendments are never sent:
 *    `answer.persistentAllow` is hidden by product policy, as for OpenCode.
 *  - **Policy may only auto-answer `kind: "command"`.** `writeStdin`, `humanCommand`, file
 *    writes and questions always go to a person.
 *  - **Bounded, redacted cards.** A command goes through the core shell formatter (redaction,
 *    truncation, risk markers). A patch shows repo-relative paths and line counts, never diff
 *    text. A secret question (`isSecret`) is never routed through Overlord.
 *  - **A subagent's request names the subagent.** Codex sends a child thread's approvals to this
 *    connection too; the card carries `details.subagent` (thread id, relation, depth, agent
 *    path, nickname, role — ids and bounded labels only) so a person knows which agent asks.
 */

/** Bounded identity of the child thread a request came from (`ThreadTree.cardOrigin`). */
export type RequestOrigin = Record<string, unknown> | null;

function withOrigin(card: RequestCard, origin: RequestOrigin | undefined): RequestCard {
  return origin ? { ...card, details: { ...card.details, subagent: origin } } : card;
}

export type PersonDecision = 'allow' | 'deny';

export type ApprovalContext = {
  method: 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval';
  codexKind: string;
  command: string | null;
  cwd: string | null;
};

/** Overlord policy hook. `null` means "ask a person". */
export type ApprovalPolicy = (context: ApprovalContext) => PersonDecision | null;

export const deferToPerson: ApprovalPolicy = () => null;

/** Apply policy under the invariant that only plain command approvals may be auto-answered. */
export function policyDecision(
  policy: ApprovalPolicy,
  context: ApprovalContext
): PersonDecision | null {
  if (
    context.method !== 'item/commandExecution/requestApproval' ||
    context.codexKind !== 'command'
  ) {
    return null;
  }
  return policy(context);
}

function literalDecisions(available: AvailableDecision[] | null | undefined): string[] | null {
  if (!Array.isArray(available)) return null;
  return available.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * The exact Codex decision for a person's (or policy's) allow/deny.
 *
 * `null` means no safe literal is on offer; the request is then left for another client.
 */
export function codexDecisionFor({
  decision,
  availableDecisions
}: {
  decision: PersonDecision;
  availableDecisions?: AvailableDecision[] | null;
}): 'accept' | 'decline' | 'cancel' | null {
  const offered = literalDecisions(availableDecisions);
  if (decision === 'allow') {
    return offered === null || offered.includes('accept') ? 'accept' : null;
  }
  if (offered === null || offered.includes('decline')) return 'decline';
  if (offered.includes('cancel')) return 'cancel';
  return null;
}

const PERMISSION_OPTIONS = [
  { optionId: 'allow', label: 'Allow once', kind: 'allow' },
  { optionId: 'deny', label: 'Deny', kind: 'deny' }
];

/**
 * Line counts only. For an `add` or `delete` change Codex sends the file content as `diff`
 * (LIVE: `"diff": "hello\n"`), so every line counts; an `update` is a unified diff.
 */
function countDiffLines(diff: unknown, kind: string): { added: number; removed: number } | null {
  if (typeof diff !== 'string' || diff.length > 4 * 1024 * 1024) return null;
  if (kind === 'add' || kind === 'delete') {
    const lines = diff === '' ? 0 : diff.replace(/\n$/, '').split('\n').length;
    return kind === 'add' ? { added: lines, removed: 0 } : { added: 0, removed: lines };
  }
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
}

export type RequestCard = {
  kind: 'permission' | 'question' | 'choice';
  summary: string;
  details: Record<string, unknown>;
  options: { optionId: string; label: string; kind: string }[];
  allowsFreeText?: boolean;
  nativeRequestId: string;
  nativeCallId: string | null;
};

export function commandApprovalCard(params: CommandApprovalParams): RequestCard {
  const command = typeof params.command === 'string' ? params.command : '';
  const cwd = typeof params.cwd === 'string' ? params.cwd : null;
  const description = describe({ tool: 'shell', input: { command }, projectRoot: cwd });
  const codexKind = typeof params.kind === 'string' ? params.kind : 'command';
  return {
    kind: 'permission',
    summary: summarizeDescription(description),
    details: {
      tool: 'shell',
      action: description.action,
      subject: description.subject,
      detail: description.detail,
      riskMarkers: description.riskMarkers,
      formatterVersion: FORMATTER_VERSION,
      codexKind: safeText(codexKind, 40).text,
      // Only a plain command may ever be answered by policy; the rest always need a person.
      requiresPerson: codexKind !== 'command'
    },
    options: PERMISSION_OPTIONS,
    nativeRequestId: nativeApprovalId(params.itemId, params.approvalId),
    nativeCallId: params.itemId
  };
}

export function fileChangeApprovalCard({
  params,
  changes,
  diffs,
  cwd
}: {
  params: FileChangeApprovalParams;
  changes: { path: string; kind: string }[];
  diffs?: unknown[];
  cwd: string | null;
}): RequestCard {
  const paths = changes
    .map(change => reduceEvidencePath(change.path, cwd) ?? safeText(change.path, 200).text)
    .slice(0, 20);
  const first = changes[0];
  const description = describe({
    tool: 'edit',
    input: first ? { path: first.path } : {},
    projectRoot: cwd
  });
  let added = 0;
  let removed = 0;
  for (const [index, diff] of (diffs ?? []).entries()) {
    const counted = countDiffLines(diff, changes[index]?.kind ?? 'update');
    if (counted) {
      added += counted.added;
      removed += counted.removed;
    }
  }
  const fileCount = changes.length;
  const summary =
    fileCount <= 1
      ? summarizeDescription(description)
      : `Change ${fileCount} files: ${paths.slice(0, 3).join(', ')}${fileCount > 3 ? ', …' : ''}`;
  return {
    kind: 'permission',
    summary,
    details: {
      tool: 'edit',
      action: fileCount <= 1 ? description.action : 'Change files',
      subject: description.subject,
      detail: `${fileCount} file${fileCount === 1 ? '' : 's'}, +${added} −${removed} lines`,
      riskMarkers: [
        ...description.riskMarkers,
        ...(params.grantRoot ? ['outside-project-directory'] : [])
      ],
      paths,
      changeKinds: changes.map(change => change.kind).slice(0, 20),
      formatterVersion: FORMATTER_VERSION,
      codexKind: 'fileChange',
      requiresPerson: true,
      requestsWriteRoot: Boolean(params.grantRoot)
    },
    options: PERMISSION_OPTIONS,
    nativeRequestId: nativeApprovalId(params.itemId, null),
    nativeCallId: params.itemId
  };
}

/**
 * A single, non-secret question becomes a channel request; anything else stays with the
 * terminal. Options get stable ids (`option-<n>`) so the answer maps back to the label Codex
 * expects.
 */
export function userInputCard(params: UserInputParams): RequestCard | null {
  if (!Array.isArray(params.questions) || params.questions.length !== 1) return null;
  const question = params.questions[0]!;
  if (question.isSecret) return null;
  const options = Array.isArray(question.options)
    ? question.options.slice(0, 11).map((option, index) => ({
        optionId: `option-${index}`,
        label: safeText(option.label, 120).text,
        kind: 'answer'
      }))
    : [];
  return {
    kind: options.length > 0 ? 'choice' : 'question',
    summary: safeText(question.question, 500).text || safeText(question.header, 120).text,
    details: {
      header: safeText(question.header, 120).text,
      questionId: safeText(question.id, 120).text,
      codexKind: 'requestUserInput'
    },
    options,
    allowsFreeText: options.length === 0 || question.isOther,
    nativeRequestId: `${params.itemId}:${question.id}`,
    nativeCallId: params.itemId
  };
}

/** Map a channel resolution for a question to `ToolRequestUserInputResponse`. */
export function userInputAnswer({
  params,
  resolution
}: {
  params: UserInputParams;
  resolution: Record<string, unknown>;
}): { answers: Record<string, { answers: string[] }> } | null {
  const question = params.questions[0];
  if (!question) return null;
  const optionId = typeof resolution.optionId === 'string' ? resolution.optionId : null;
  const text = typeof resolution.text === 'string' ? resolution.text.trim() : '';
  let answer: string | null = null;
  if (optionId) {
    const match = /^option-(\d+)$/.exec(optionId);
    const option = match ? question.options?.[Number(match[1])] : undefined;
    answer = option?.label ?? null;
  }
  if (answer === null && text) answer = text;
  if (answer === null) return null;
  return { answers: { [question.id]: { answers: [answer] } } };
}

export function nativeApprovalId(itemId: string, approvalId: string | null | undefined): string {
  return approvalId ? `${itemId}:${approvalId}` : itemId;
}

export function readPersonDecision(resolution: unknown): PersonDecision | null {
  const record =
    resolution && typeof resolution === 'object' && !Array.isArray(resolution)
      ? (resolution as Record<string, unknown>)
      : null;
  const value = record?.decision ?? record?.optionId;
  return value === 'allow' || value === 'deny' ? value : null;
}

type Wait =
  | { outcome: 'resolved'; resolution: Record<string, unknown> }
  | { outcome: 'elsewhere' }
  | { outcome: 'released' }
  | { outcome: 'abandoned' };

/**
 * Routes Codex server requests through the session channel.
 *
 * One instance per supervisor. `rpcId → state` tracks which Codex requests Overlord is
 * waiting on, so a `serverRequest/resolved` for one of them can close its card.
 */
export class DecisionRouter {
  private readonly waiting = new Map<
    RpcId,
    { requestId: string; elsewhere: boolean; abandoned: boolean }
  >();
  /** Approvals Codex (re)sent since the last reconnect began. */
  private readonly replayed = new Set<string>();
  /** nativeRequestId → channel request id, so a replayed approval reuses its card. */
  private readonly cards = new Map<string, string>();
  private readonly answered = new Set<RpcId>();

  constructor(
    private readonly options: {
      client: ChannelClient;
      tracker: ThreadTracker;
      cwd: () => string | null;
      policy?: ApprovalPolicy;
      sleep?: (ms: number) => Promise<void>;
      pollIntervalMs?: number;
    }
  ) {}

  /**
   * The connection dropped: waits tied to its JSON-RPC ids can no longer answer anything. Their
   * cards stay open, because Codex replays a still-pending approval to the next connection.
   */
  abandonAll(): void {
    for (const entry of this.waiting.values()) entry.abandoned = true;
    this.waiting.clear();
    this.answered.clear();
  }

  /** Start a reconnect: remember which cards are open so unreplayed ones can be closed. */
  beginReconcile(): Set<string> {
    this.replayed.clear();
    return new Set(this.cards.keys());
  }

  /** Cards whose approval Codex did not replay were answered while Overlord was away. */
  async finishReconcile(openBefore: Set<string>): Promise<void> {
    for (const nativeRequestId of openBefore) {
      if (this.replayed.has(nativeRequestId)) continue;
      const requestId = this.cards.get(nativeRequestId);
      if (!requestId) continue;
      this.cards.delete(nativeRequestId);
      const base = nativeRequestId.replace(/#\d+$/, '');
      this.settled.set(base, (this.settled.get(base) ?? 0) + 1);
      await this.options.client.post(
        `/requests/${encodeURIComponent(requestId)}/resolved-elsewhere`,
        {}
      );
    }
  }

  /** `serverRequest/resolved`: someone answered a Codex request. */
  async onServerRequestResolved(params: unknown): Promise<void> {
    const record =
      params && typeof params === 'object' ? (params as Record<string, unknown>) : null;
    const rpcId = record?.requestId as RpcId | undefined;
    if (rpcId === undefined || rpcId === null) return;
    if (this.answered.delete(rpcId)) return;
    const entry = this.waiting.get(rpcId);
    if (!entry) return;
    entry.elsewhere = true;
    await this.options.client.post(
      `/requests/${encodeURIComponent(entry.requestId)}/resolved-elsewhere`,
      {}
    );
  }

  async commandApproval(
    params: unknown,
    rpcId: RpcId,
    origin: RequestOrigin = null
  ): Promise<unknown> {
    const request = params as CommandApprovalParams;
    const card = withOrigin(commandApprovalCard(request), origin);
    const auto = policyDecision(this.options.policy ?? deferToPerson, {
      method: 'item/commandExecution/requestApproval',
      codexKind: typeof request.kind === 'string' ? request.kind : 'command',
      command: typeof request.command === 'string' ? request.command : null,
      cwd: typeof request.cwd === 'string' ? request.cwd : null
    });
    if (auto) {
      const decision = codexDecisionFor({
        decision: auto,
        availableDecisions: request.availableDecisions
      });
      if (decision) {
        this.answered.add(rpcId);
        return { decision };
      }
    }
    return await this.routeToPerson(card, rpcId, resolution => {
      const decision = readPersonDecision(resolution);
      const mapped = decision
        ? codexDecisionFor({ decision, availableDecisions: request.availableDecisions })
        : null;
      return mapped ? { decision: mapped } : null;
    });
  }

  async fileChangeApproval(
    params: unknown,
    rpcId: RpcId,
    origin: RequestOrigin = null
  ): Promise<unknown> {
    const request = params as FileChangeApprovalParams;
    const changes = this.options.tracker.fileChanges.get(request.itemId) ?? [];
    const card = withOrigin(
      fileChangeApprovalCard({
        params: request,
        changes,
        diffs: this.diffsFor(request.itemId),
        cwd: this.options.cwd()
      }),
      origin
    );
    return await this.routeToPerson(card, rpcId, resolution => {
      const decision = readPersonDecision(resolution);
      const mapped = decision ? codexDecisionFor({ decision }) : null;
      return mapped ? { decision: mapped } : null;
    });
  }

  async userInput(params: unknown, rpcId: RpcId, origin: RequestOrigin = null): Promise<unknown> {
    const request = params as UserInputParams;
    const base = userInputCard(request);
    if (!base) return NoResponse.instance;
    const card = withOrigin(base, origin);
    return await this.routeToPerson(card, rpcId, resolution =>
      userInputAnswer({ params: request, resolution })
    );
  }

  /** Diffs are only counted, never copied; they are read from the tracked started item. */
  private readonly diffSource = new Map<string, unknown[]>();
  recordDiffs(itemId: string, diffs: unknown[]): void {
    this.diffSource.set(itemId, diffs);
  }
  forgetDiffs(itemId: string): void {
    this.diffSource.delete(itemId);
  }
  private diffsFor(itemId: string): unknown[] {
    const diffs = this.diffSource.get(itemId) ?? [];
    this.diffSource.delete(itemId);
    return diffs;
  }

  /**
   * nativeRequestId → how many of its requests already settled here (answered by Overlord or
   * elsewhere). Codex can ask twice about one item — a command that failed in the sandbox is
   * asked again to run outside it, with the same item id — and the server dedupes cards by
   * native id, returning the earlier card with its answer. A later request for a settled id
   * therefore gets its own occurrence id, so an earlier "allow" is never applied to a new,
   * possibly broader, approval. A replay of a still-open card keeps its id.
   */
  private readonly settled = new Map<string, number>();

  private occurrenceOf(card: RequestCard): RequestCard {
    if (this.cards.has(card.nativeRequestId)) return card;
    const count = this.settled.get(card.nativeRequestId) ?? 0;
    return count === 0
      ? card
      : { ...card, nativeRequestId: `${card.nativeRequestId}#${count + 1}` };
  }

  private settle(card: RequestCard, base: string): void {
    this.cards.delete(card.nativeRequestId);
    this.settled.set(base, (this.settled.get(base) ?? 0) + 1);
  }

  private async routeToPerson(
    baseCard: RequestCard,
    rpcId: RpcId,
    toAnswer: (resolution: Record<string, unknown>) => unknown
  ): Promise<unknown> {
    const { client } = this.options;
    const card = this.occurrenceOf(baseCard);
    this.replayed.add(card.nativeRequestId);
    let requestId = this.cards.get(card.nativeRequestId) ?? null;
    let immediate: Record<string, unknown> | null = null;
    if (!requestId) {
      const created = await client.post<{ requestId: string; status: string }>('/requests', card, {
        timeoutMs: 5000
      });
      // No channel: leave the request to the terminal rather than invent an answer.
      if (!created.ok) return NoResponse.instance;
      requestId = created.value.requestId;
      this.cards.set(card.nativeRequestId, requestId);
      if (created.value.status === 'resolved') {
        const current = await client.get<{ resolution: unknown }>(`/requests/${requestId}`);
        if (
          current.ok &&
          current.value.resolution &&
          typeof current.value.resolution === 'object'
        ) {
          immediate = current.value.resolution as Record<string, unknown>;
        }
      }
    }
    const wait: Wait = immediate
      ? { outcome: 'resolved', resolution: immediate }
      : await this.waitForResolution(requestId, rpcId);
    if (wait.outcome === 'abandoned') return NoResponse.instance;
    this.waiting.delete(rpcId);
    if (wait.outcome !== 'resolved') {
      if (wait.outcome === 'elsewhere') this.settle(card, baseCard.nativeRequestId);
      return NoResponse.instance;
    }
    const answer = toAnswer(wait.resolution);
    if (answer === null || answer === undefined) return NoResponse.instance;
    this.answered.add(rpcId);
    this.settle(card, baseCard.nativeRequestId);
    await client.post(`/requests/${encodeURIComponent(requestId)}/application`, {
      applicationState: 'emitted'
    });
    return answer;
  }

  /**
   * Hold a waiter lease while a person decides. If this process dies the lease lapses and the
   * server releases the card; the Codex request stays open for the terminal, which is the
   * honest outcome. There is no harness timeout to race: Codex holds an approval until a client
   * answers it.
   */
  private async waitForResolution(requestId: string, rpcId: RpcId): Promise<Wait> {
    const { client } = this.options;
    const state = { requestId, elsewhere: false, abandoned: false };
    this.waiting.set(rpcId, state);
    const sleep = this.options.sleep ?? defaultSleep;
    let leaseId: string | undefined;
    for (;;) {
      if (state.abandoned) return { outcome: 'abandoned' };
      if (state.elsewhere) return { outcome: 'elsewhere' };
      const lease = await client.post<{
        leaseId: string;
        status: string;
        resolution: unknown;
      }>(`/requests/${encodeURIComponent(requestId)}/lease`, leaseId ? { leaseId } : {}, {
        timeoutMs: 5000
      });
      if (state.abandoned) return { outcome: 'abandoned' };
      if (state.elsewhere) return { outcome: 'elsewhere' };
      if (lease.ok) {
        leaseId = lease.value.leaseId;
        if (lease.value.status === 'resolved') {
          const resolution = lease.value.resolution;
          return resolution && typeof resolution === 'object'
            ? { outcome: 'resolved', resolution: resolution as Record<string, unknown> }
            : { outcome: 'released' };
        }
        if (lease.value.status !== 'open') return { outcome: 'released' };
      } else if (lease.reason === 'unauthorized') {
        return { outcome: 'released' };
      } else {
        const current = await client.get<{ status: string; resolution: unknown }>(
          `/requests/${encodeURIComponent(requestId)}`,
          { timeoutMs: 3000 }
        );
        if (current.ok && current.value.status === 'resolved') {
          const resolution = current.value.resolution;
          if (resolution && typeof resolution === 'object') {
            return { outcome: 'resolved', resolution: resolution as Record<string, unknown> };
          }
        }
        if (current.ok && current.value.status !== 'open') return { outcome: 'released' };
        if (!current.ok && current.reason === 'unauthorized') return { outcome: 'released' };
      }
      await sleep(this.options.pollIntervalMs ?? 750);
    }
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
