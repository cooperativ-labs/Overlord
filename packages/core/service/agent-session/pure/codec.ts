import { describe } from './describe/index.js';
import { FORMATTER_VERSION } from './describe/types.js';
import {
  type AgentSessionEventKind,
  deriveProducerEventId,
  isAgentSessionEventKind,
  type NormalizedEvent,
  type NormalizedEventPayload,
  sealPayload,
  summarizeDescription
} from './envelope.js';
import { reduceEvidencePath } from './evidence-path.js';
import { redactSecrets } from './redact.js';
import { safeText } from './text.js';
import { normalizeToolName } from './tool-normalize.js';

/**
 * The codec interpreter: connector-owned dialect as data, core-owned interpretation as code.
 *
 * A codec could have been a TypeScript function per adapter, and that was the first design. It
 * is worse, for a reason that only shows up on the fifth adapter: a function can do anything,
 * so reviewing a codec means reading code, and "does this codec forward a raw field?" becomes a
 * question you answer by reading rather than by looking. Expressed as a declaration, a codec
 * can only say *where* its native values live. It cannot invent a destination for them, because
 * the only destinations are the ones this file implements.
 *
 * That is also what makes the build step honest. `codec-registry.generated.ts` is compiled from
 * the connector-owned specs; the CLI executes them but is not the source of truth for any
 * harness dialect, exactly as the module layout requires.
 *
 * The interpreter is total: an unmatched native event returns `null` (nothing to say), and a
 * matched one always produces a complete, sealed envelope.
 */

export type CodecEventRule = {
  /** Native event name this rule matches, case-sensitively. */
  native: string;
  kind: AgentSessionEventKind;
  origin: 'agent' | 'user' | 'system';
  severity?: 'info' | 'notice' | 'warning' | 'error';
  /** Dotted path to the native tool name. */
  toolPath?: string;
  /** Dotted path to the native tool input object. */
  inputPath?: string;
  /** Dotted path to a per-call identifier, used for idempotency and correlation. */
  callIdPath?: string;
  turnIdPath?: string;
  subagentIdPath?: string;
  /** Dotted path to prompt text. Persisted in full — the deliberate §9 exception. */
  promptPath?: string;
  /** Dotted path to a short structural detail (a lifecycle `source`, a reason code). */
  detailPath?: string;
  /** Dotted path to a boolean/string success indicator. Never the output itself. */
  outcomePath?: string;
  /** Ordered dotted paths, relative to inputPath, that may carry exact edit evidence. */
  filePathPaths?: string[];
  /**
   * When the normalized tool is a file mutation, emit this kind instead.
   *
   * One native event covers "the agent used a tool" and "the agent changed a file"; a feed that
   * cannot tell those apart cannot show a file-change timeline, so the split happens here where
   * the normalized tool name is already known.
   */
  fileEditKind?: 'file.edited';
};

export type CodecSpec = {
  codecVersion: 1;
  adapter: string;
  /** Where the native event name lives when the payload carries it. */
  eventNamePath?: string;
  /**
   * Candidate paths for the native event name, tried in order after `eventNamePath`.
   *
   * Most harnesses name the event in exactly one place, and those codecs should keep using the
   * singular field. Cursor is the exception that forced the plural: it carries the name as
   * `hook_event_name` on some events and `event` on others, which a single path cannot express.
   * Getting it wrong there is invisible rather than loud — an unresolved name means no rule
   * matches, and no rule matching is the interpreter's normal "nothing to say" outcome — so the
   * failure would look exactly like a harness that simply never fired.
   */
  eventNamePaths?: string[];
  /** Candidate paths for the native session id, tried in order. Correlation only. */
  nativeSessionPaths?: string[];
  /** Candidate paths for the working directory, used only to relativize file paths. */
  projectRootPaths?: string[];
  events: CodecEventRule[];
};

/** Resolve a dotted path against an untrusted object without ever throwing. */
export function readPath(source: unknown, dotted: string | undefined): unknown {
  if (!dotted) return undefined;
  let current: unknown = source;
  for (const segment of dotted.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = Array.isArray(current)
      ? (current as unknown[])[Number(segment)]
      : (current as Record<string, unknown>)[segment];
  }
  return current;
}

function firstString(source: unknown, paths: string[] | undefined): string | null {
  for (const path of paths ?? []) {
    const value = readPath(source, path);
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function firstLiteralString(source: unknown, paths: string[] | undefined): string | null {
  for (const path of paths ?? []) {
    const value = readPath(source, path);
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function boundedId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = safeText(value, 200).text;
  return text === '' ? null : text;
}

function readOutcome(value: unknown): NormalizedEventPayload['outcome'] | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === true) return 'ok';
  if (value === false) return 'error';
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered === 'ok' || lowered === 'success' || lowered === 'completed') return 'ok';
    if (lowered === 'error' || lowered === 'failed' || lowered === 'failure') return 'error';
    if (lowered === 'blocked' || lowered === 'denied') return 'blocked';
    if (lowered === 'cancelled' || lowered === 'canceled' || lowered === 'interrupted') {
      return 'cancelled';
    }
  }
  return undefined;
}

export function findCodecRule(
  codec: CodecSpec,
  nativeEventName: string | null
): CodecEventRule | null {
  if (!nativeEventName) return null;
  return codec.events.find(rule => rule.native === nativeEventName) ?? null;
}

export function resolveNativeEventName(codec: CodecSpec, payload: unknown): string | null {
  const paths = [
    ...(codec.eventNamePath ? [codec.eventNamePath] : []),
    ...(codec.eventNamePaths ?? [])
  ];
  return firstString(payload, paths);
}

export function resolveNativeSessionId(codec: CodecSpec, payload: unknown): string | null {
  return firstString(payload, codec.nativeSessionPaths);
}

/**
 * Normalize one native payload into an envelope, or `null` if this codec has nothing to say
 * about it.
 *
 * `null` is a normal outcome, not an error. A harness fires events Overlord has not registered
 * for and does not care about; the correct response is silence, and treating "unmapped" as a
 * failure would produce diagnostics for the normal case.
 */
export function normalizeNativeEvent({
  codec,
  payload,
  nativeEventName,
  nativeSessionId,
  occurredAt,
  producerSequence = null
}: {
  codec: CodecSpec;
  payload: unknown;
  /** Override when the transport, not the payload, carries the event name. */
  nativeEventName?: string | null;
  nativeSessionId?: string | null;
  occurredAt: string;
  producerSequence?: number | null;
}): NormalizedEvent | null {
  const eventName = nativeEventName ?? resolveNativeEventName(codec, payload);
  const rule = findCodecRule(codec, eventName);
  if (!rule || !isAgentSessionEventKind(rule.kind)) return null;

  const sessionId = nativeSessionId ?? resolveNativeSessionId(codec, payload);
  const projectRoot = firstLiteralString(payload, codec.projectRootPaths);
  const nativeCallId = boundedId(readPath(payload, rule.callIdPath));
  const nativeTurnId = boundedId(readPath(payload, rule.turnIdPath));
  const subagentId = boundedId(readPath(payload, rule.subagentIdPath));

  let kind: AgentSessionEventKind = rule.kind;
  const sealedInput: NormalizedEventPayload = {};
  const idParts: (string | number | null)[] = [nativeCallId, nativeTurnId];

  if (rule.toolPath) {
    const nativeTool = readPath(payload, rule.toolPath);
    const tool = normalizeToolName(nativeTool);
    const input = rule.inputPath ? readPath(payload, rule.inputPath) : undefined;
    const description = describe({ tool, input, projectRoot });

    sealedInput.tool = tool;
    sealedInput.action = description.action;
    if (description.subject) sealedInput.subject = description.subject;
    if (description.detail) sealedInput.detail = description.detail;
    if (description.riskMarkers.length > 0) sealedInput.riskMarkers = description.riskMarkers;
    if (description.keys && description.keys.length > 0) sealedInput.keys = description.keys;
    sealedInput.formatterVersion = FORMATTER_VERSION;

    if (rule.fileEditKind && (tool === 'write' || tool === 'edit')) {
      kind = rule.fileEditKind;
      const evidencePath = (rule.filePathPaths ?? []).reduce<string | null>(
        (accepted, declaredPath) =>
          accepted ?? reduceEvidencePath(readPath(input, declaredPath), projectRoot),
        null
      );
      if (evidencePath) {
        sealedInput.paths = [evidencePath];
        idParts.push(evidencePath);
      }
    }

    // Tool name and subject identify the call when the harness gives us no call id — which is
    // the common case for `PostToolUse`-shaped events.
    idParts.push(tool, description.subject ?? '', description.detail ?? '');
  }

  if (rule.promptPath) {
    const raw = readPath(payload, rule.promptPath);
    if (typeof raw === 'string' && raw.trim() !== '') {
      // Prompt text is persisted in full for bound sessions: the activity feed exists to show
      // it. Secret redaction still runs, because a prompt is a place people paste tokens.
      const { text } = redactSecrets(raw.trim());
      sealedInput.promptText = text.slice(0, 20_000);
      idParts.push(text.length, text.slice(0, 64));
    } else {
      // A prompt event with no prompt is not an event.
      return null;
    }
  }

  if (rule.detailPath && !sealedInput.detail) {
    const detail = readPath(payload, rule.detailPath);
    if (typeof detail === 'string' && detail.trim() !== '') {
      sealedInput.detail = safeText(detail, 200).text;
      idParts.push(sealedInput.detail);
    }
  }

  if (rule.outcomePath) {
    const outcome = readOutcome(readPath(payload, rule.outcomePath));
    if (outcome) sealedInput.outcome = outcome;
  }

  const payloadOut = sealPayload(sealedInput);
  const summary = summarizeEvent(kind, payloadOut);

  return {
    eventId: deriveProducerEventId({
      adapterKey: codec.adapter,
      nativeSessionId: sessionId,
      nativeEvent: rule.native,
      parts: idParts
    }),
    producerSequence,
    occurredAt,
    kind,
    severity: rule.severity ?? 'info',
    nativeEvent: rule.native,
    nativeTurnId,
    nativeCallId,
    subagentId,
    correlationId: sessionId,
    origin: rule.origin,
    summary,
    payload: payloadOut
  };
}

/**
 * The one-line feed summary.
 *
 * Derived from the already-sealed payload rather than from the native input, so there is
 * exactly one place where model-controlled text can reach a rendered string, and it has already
 * been escaped, redacted, and bounded by the time it gets here.
 */
export function summarizeEvent(
  kind: AgentSessionEventKind,
  payload: NormalizedEventPayload
): string | null {
  if (kind === 'prompt.submitted') {
    const text = payload.promptText ?? '';
    return safeText(text, 200).text || 'Prompt submitted';
  }
  if (kind === 'session.started') return 'Session started';
  if (kind === 'session.ended') return 'Session ended';
  if (!payload.action) return null;
  return summarizeDescription({
    action: payload.action,
    subject: payload.subject ?? null,
    detail: payload.detail ?? null,
    riskMarkers: (payload.riskMarkers ?? []) as never
  });
}
