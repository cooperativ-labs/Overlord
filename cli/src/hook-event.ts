import {
  type CodecEventRule,
  type CodecSpec,
  findCodecRule,
  readPath,
  resolveNativeEventName,
  resolveNativeSessionId
} from '@overlord/core/service/agent-session/pure/codec';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import path from 'node:path';

import { findAgentSessionCodec } from './agent-session/codec-registry.generated.js';
import { parseNativePayload } from './agent-session/event.js';
import { hasRunningBackgroundTasks } from './agent-session/inbox.js';
import type { BackendClient } from './backend-client.js';
import {
  hasStopReminder,
  isRepeatedHookPrompt,
  markStopReminder,
  nextHookTurnIndex,
  recordHookPrompt,
  resolveHookBinding
} from './hook-binding.js';

/**
 * `ovld protocol hook-event --agent <key> --payload-file -` — the native hook entry point.
 *
 * This is the one implementation of the mission-lifecycle hooks. The CLI fallback calls it
 * directly, and the Claude `mcp_tool` hooks reach it because the plugin's local hooks server
 * spawns this same command with the same native payload on stdin. The hooks server adds no logic
 * of its own, so the two paths cannot drift.
 *
 * The result always carries `hookOutput`: the exact JSON object the harness hook must answer
 * with. It is `{}` unless there is something to say. A hook path never fails the harness, so
 * every outcome (unbound, nothing to do, backend error) is a result with `hookOutput: {}`, never
 * an exception.
 */

export const NATIVE_HOOK_TYPES = ['UserPromptSubmit', 'Stop'] as const;
export type NativeHookType = (typeof NATIVE_HOOK_TYPES)[number];

export type NativeHookEventResult = {
  hookType: string | null;
  recorded: boolean;
  skipped?:
    | 'no_codec'
    | 'no_payload'
    | 'event_mismatch'
    | 'unsupported_event'
    | 'unbound'
    | 'empty_prompt'
    | 'repeated_prompt'
    | 'harness_notification'
    | 'stop_hook_active'
    | 'background_tasks_running'
    | 'no_session_key'
    | 'already_reminded'
    | 'backend_error';
  eventId?: string | null;
  objectiveId?: string | null;
  sessionId?: string | null;
  deliveryStatus?: { needed: boolean; reason: string | null };
  hookOutput: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isNativeHookType(value: string | null): value is NativeHookType {
  return value !== null && (NATIVE_HOOK_TYPES as readonly string[]).includes(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Prompts the harness writes itself and submits through UserPromptSubmit. They are not a user's
 * follow-up and are never recorded as one. Claude Code wakes the main agent with a
 * `<task-notification>` prompt when a background subagent finishes
 * (fixtures/subagent-stop-background.json).
 */
const HARNESS_NOTIFICATION_PROMPT_PREFIXES: Record<string, readonly string[]> = {
  claude: ['<task-notification>']
};

export function isHarnessNotificationPrompt(agent: string, prompt: string): boolean {
  const prefixes = HARNESS_NOTIFICATION_PROMPT_PREFIXES[agent.trim().toLowerCase()] ?? [];
  const text = prompt.trimStart();
  return prefixes.some(prefix => text.startsWith(prefix));
}

/** Claude sends a boolean. A templated `mcp_tool` input arrives as the string "true". */
function isTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

function isFalse(value: unknown): boolean {
  return value === false || value === 'false';
}

/**
 * The canonical hook type a native event stands for.
 *
 * The protocol has two lifecycle hook types. Claude and Codex name them natively; Antigravity has
 * no per-submission prompt event, and carries the submitted prompt as `lastUserInput` on
 * `PreInvocation`. The connector codec says which native event is a prompt submission (its rule
 * kind is `prompt.submitted`), so that mapping is connector-owned rather than a name list here.
 */
function canonicalHookType(codec: CodecSpec, nativeEvent: string | null): NativeHookType | null {
  if (isNativeHookType(nativeEvent)) return nativeEvent;
  const rule = findCodecRule(codec, nativeEvent);
  return rule?.kind === 'prompt.submitted' ? 'UserPromptSubmit' : null;
}

/** The codec rule that names the prompt: the native event's own, else the codec's prompt rule. */
function promptRule(codec: CodecSpec, nativeEvent: string | null): CodecEventRule | null {
  const own = findCodecRule(codec, nativeEvent);
  if (own?.promptPath) return own;
  return (
    findCodecRule(codec, 'UserPromptSubmit') ??
    codec.events.find(rule => rule.kind === 'prompt.submitted' && rule.promptPath) ??
    null
  );
}

/**
 * Whether the prompt event fires once per model invocation rather than once per submission.
 *
 * Antigravity's `PreInvocation` repeats the same `lastUserInput` before every model call of a
 * turn, so the hook records a prompt only when it differs from the last one recorded for the
 * conversation. A native `UserPromptSubmit` is one submission per call and is never collapsed.
 */
function isPerInvocationPromptEvent(rule: CodecEventRule | null): boolean {
  return rule !== null && rule.native !== 'UserPromptSubmit';
}

/**
 * The working directory a native payload names, when it names an existing absolute directory.
 *
 * A harness may run hook commands from somewhere other than the session's project — Antigravity
 * runs plugin hooks with the plugin folder as their working directory — and the session-key cache
 * is keyed by the project directory. The codec's `projectRootPaths` say where the payload names
 * it. The value only locates the cache entry; the launch environment or the native-session
 * index still decides the binding.
 */
function payloadWorkingDirectory(codec: CodecSpec, payload: unknown): string | null {
  for (const rootPath of codec.projectRootPaths ?? []) {
    const value = readPath(payload, rootPath);
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 4_096) continue;
    try {
      if (statSync(value).isDirectory()) return path.resolve(value);
    } catch {
      // Not a directory on this machine; try the next declared path.
    }
  }
  return null;
}

/**
 * The exact Stop answer that continues the agent with `reason`.
 *
 * Claude and Codex continue on `decision: "block"`. Antigravity's Stop hook continues on
 * `decision: "continue"` and injects `reason` as a system message; any other decision lets the
 * stop happen, so Claude's spelling would be a silent no-op there.
 */
const STOP_CONTINUE_DECISION: Readonly<Record<string, string>> = Object.freeze({
  antigravity: 'continue'
});

export function stopContinueOutput(agent: string, reason: string): Record<string, unknown> {
  return { decision: STOP_CONTINUE_DECISION[agent] ?? 'block', reason };
}

function promptDigest(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

export async function runNativeHookEvent({
  backend,
  agent,
  hookTypeFlag,
  payloadRaw,
  workingDirectory,
  missionId,
  objectiveId,
  env = process.env
}: {
  backend: Pick<BackendClient, 'post'>;
  agent: string;
  hookTypeFlag: string | null;
  payloadRaw: string | null;
  workingDirectory: string;
  missionId?: string | null;
  objectiveId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<NativeHookEventResult> {
  const normalizedAgent = agent.trim().toLowerCase();
  const skip = (
    skipped: NonNullable<NativeHookEventResult['skipped']>,
    hookType: string | null = hookTypeFlag
  ): NativeHookEventResult => ({ hookType, recorded: false, skipped, hookOutput: {} });

  const codec = findAgentSessionCodec(normalizedAgent);
  if (!codec) return skip('no_codec');
  const payload = parseNativePayload(payloadRaw);
  if (!payload || typeof payload !== 'object') return skip('no_payload');

  const nativeEvent = resolveNativeEventName(codec, payload);
  const nativeHookType = canonicalHookType(codec, nativeEvent);
  if (hookTypeFlag && nativeEvent && hookTypeFlag !== nativeEvent) {
    if (hookTypeFlag !== nativeHookType) return skip('event_mismatch');
  }
  const hookType = hookTypeFlag ?? nativeHookType ?? nativeEvent;
  if (!isNativeHookType(hookType)) return skip('unsupported_event', hookType);

  const nativeSessionId = resolveNativeSessionId(codec, payload);
  // Scope gate: everything above is a bounded parse of the payload already in hand. Nothing
  // below runs for a session Overlord did not launch or attach.
  const binding = resolveHookBinding({
    agent: normalizedAgent,
    nativeSessionId,
    workingDirectory: payloadWorkingDirectory(codec, payload) ?? workingDirectory,
    missionId,
    objectiveId,
    env
  });
  if (!binding) return skip('unbound', hookType);

  const post = async (
    flags: Record<string, string>,
    fileInputs: Record<string, string> = {}
  ): Promise<Record<string, unknown> | null> => {
    try {
      return asRecord(
        await backend.post<unknown>({
          path: '/api/protocol/hook-event',
          body: {
            args: [],
            positional: [],
            flags: {
              '--hook-type': hookType,
              '--mission-id': binding.missionId,
              ...(binding.sessionKey ? { '--session-key': binding.sessionKey } : {}),
              ...(nativeSessionId ? { '--external-session-id': nativeSessionId } : {}),
              ...flags
            },
            fileInputs,
            externalSessionId: nativeSessionId ?? undefined
          }
        })
      );
    } catch {
      return null;
    }
  };

  if (hookType === 'UserPromptSubmit') {
    const rule = promptRule(codec, nativeEvent);
    const prompt = stringOrNull(readPath(payload, rule?.promptPath ?? 'prompt'))?.trim() ?? '';
    if (!prompt) return skip('empty_prompt', hookType);
    if (isHarnessNotificationPrompt(normalizedAgent, prompt)) {
      return skip('harness_notification', hookType);
    }
    const perInvocation = isPerInvocationPromptEvent(rule);
    const digest = promptDigest(prompt);
    if (perInvocation && nativeSessionId) {
      if (isRepeatedHookPrompt({ agent: normalizedAgent, nativeSessionId, digest })) {
        return skip('repeated_prompt', hookType);
      }
    }
    const turnIndex = nativeSessionId
      ? nextHookTurnIndex({ agent: normalizedAgent, nativeSessionId })
      : null;
    // Prompt text travels as a file input, never as a flag: flags can end up in argv.
    const result = await post(turnIndex === null ? {} : { '--turn-index': String(turnIndex) }, {
      '--prompt-file': prompt
    });
    if (!result) return skip('backend_error', hookType);
    if (perInvocation && nativeSessionId) {
      recordHookPrompt({ agent: normalizedAgent, nativeSessionId, digest });
    }
    return {
      hookType,
      recorded: true,
      eventId: stringOrNull(result.eventId),
      objectiveId: stringOrNull(result.objectiveId),
      sessionId: stringOrNull(result.sessionId),
      hookOutput: {}
    };
  }

  // Stop: the delivery reminder. `stop_hook_active` means this stop already follows a block,
  // so answering again could loop; the reminder is also shown once per session and objective.
  // Antigravity spells the same guard `continuation_active` (agy 1.5.6): this stop already
  // follows a continuation an earlier Stop hook requested.
  if (
    isTrue(readPath(payload, 'stop_hook_active')) ||
    isTrue(readPath(payload, 'continuation_active'))
  ) {
    return skip('stop_hook_active', hookType);
  }
  // Background subagents still running: Claude wakes the main agent when they finish, and that
  // turn ends in another Stop. Remind then, not before the work is done. Antigravity reports the
  // same state as `fullyIdle: false` (background commands or async tasks still running).
  if (hasRunningBackgroundTasks(payload) || isFalse(readPath(payload, 'fullyIdle'))) {
    return skip('background_tasks_running', hookType);
  }
  if (!binding.sessionKey) return skip('no_session_key', hookType);
  if (hasStopReminder(binding.sessionKey, binding.objectiveId)) {
    return skip('already_reminded', hookType);
  }
  const result = await post({});
  if (!result) return skip('backend_error', hookType);
  const status = asRecord(result.deliveryStatus);
  const deliveryStatus = {
    needed: status.needed === true,
    reason: stringOrNull(status.reason)
  };
  const base = {
    hookType,
    recorded: false,
    objectiveId: stringOrNull(result.objectiveId),
    sessionId: stringOrNull(result.sessionId),
    deliveryStatus
  };
  if (!deliveryStatus.needed) return { ...base, hookOutput: {} };
  markStopReminder(binding.sessionKey, binding.objectiveId);
  return {
    ...base,
    hookOutput: stopContinueOutput(
      normalizedAgent,
      `[Overlord] ${deliveryStatus.reason ?? 'This objective has not been delivered yet.'}`
    )
  };
}
