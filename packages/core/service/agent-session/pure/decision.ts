import { describe } from './describe/index.js';
import { type Description, FORMATTER_VERSION } from './describe/types.js';
import { readPath } from './codec.js';
import { summarizeDescription } from './envelope.js';
import { safeText } from './text.js';
import { type NormalizedTool, normalizeToolName } from './tool-normalize.js';

export type NativeDecision = 'allow' | 'deny' | 'ask';

export type DecisionRequestRule = {
  native: string;
  tool?: NormalizedTool;
  toolPath?: string;
  inputPath?: string;
  /** Wrap a scalar native value for a formatter that expects an object. */
  inputWrapKey?: string;
  requestIdPaths?: string[];
  callIdPaths?: string[];
  timeoutPaths?: string[];
};

export type DecisionResponseRule = { body: unknown } | { defer: true };

export type DecisionCodecSpec = {
  codecVersion: 1;
  adapter: string;
  eventNamePaths: string[];
  projectRootPaths?: string[];
  requests: DecisionRequestRule[];
  responses: Record<NativeDecision, DecisionResponseRule>;
};

export type DecodedNativeDecisionRequest = {
  kind: 'permission';
  summary: string;
  details: Description & { tool: NormalizedTool; formatterVersion: number };
  nativeRequestId: string | null;
  nativeCallId: string | null;
  harnessTimeoutSeconds: number | null;
};

function firstValue(source: unknown, paths: string[] | undefined): unknown {
  for (const path of paths ?? []) {
    const value = readPath(source, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function firstString(source: unknown, paths: string[] | undefined, max = 200): string | null {
  const value = firstValue(source, paths);
  if (typeof value !== 'string' || value.trim() === '') return null;
  return safeText(value.trim(), max).text || null;
}

function timeoutSeconds(source: unknown, paths: string[] | undefined): number | null {
  const value = firstValue(source, paths);
  return typeof value === 'number' && Number.isFinite(value) && value > 1 ? value : null;
}

/**
 * Decode a native permission payload through a connector-owned declaration.
 *
 * The declaration can identify paths but cannot decide what leaves the machine. Core always
 * runs the same deterministic description formatter, so a command containing a credential is
 * redacted before the request reaches REST and an unknown tool exposes key names only.
 */
export function decodeDecisionRequest(
  codec: DecisionCodecSpec,
  payload: unknown
): DecodedNativeDecisionRequest | null {
  const nativeEvent = firstString(payload, codec.eventNamePaths, 100);
  if (!nativeEvent) return null;
  const rule = codec.requests.find(candidate => candidate.native === nativeEvent);
  if (!rule) return null;

  const nativeTool = rule.tool ?? normalizeToolName(readPath(payload, rule.toolPath));
  const rawInput = rule.inputPath ? readPath(payload, rule.inputPath) : undefined;
  const input = rule.inputWrapKey ? { [rule.inputWrapKey]: rawInput } : rawInput;
  const projectRoot = firstString(payload, codec.projectRootPaths, 1_000);
  const description = describe({ tool: nativeTool, input, projectRoot });

  return {
    kind: 'permission',
    summary: summarizeDescription(description),
    details: {
      tool: nativeTool,
      action: description.action,
      subject: description.subject,
      detail: description.detail,
      riskMarkers: description.riskMarkers,
      ...(description.keys ? { keys: description.keys } : {}),
      formatterVersion: FORMATTER_VERSION
    },
    nativeRequestId: firstString(payload, rule.requestIdPaths),
    nativeCallId: firstString(payload, rule.callIdPaths),
    harnessTimeoutSeconds: timeoutSeconds(payload, rule.timeoutPaths)
  };
}

/** Emit the connector-declared exact native JSON line, or silence for defer. */
export function encodeDecisionResponse(codec: DecisionCodecSpec, decision: unknown): string | null {
  if (decision !== 'allow' && decision !== 'deny' && decision !== 'ask') return null;
  const response = codec.responses[decision];
  if (!response || 'defer' in response) return null;
  return `${JSON.stringify(response.body)}\n`;
}
