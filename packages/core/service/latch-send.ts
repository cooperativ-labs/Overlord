/**
 * Relay a pending Latch `awaiting_input` through the public CLI.
 *
 * `latch send SESSION --resolve id=choice --json` is Latch Phase 3. When the
 * binary has no `send` command, this reports that honestly instead of
 * pretending Overlord answered the prompt.
 */

import { spawnSync } from 'node:child_process';

import type { InteractionCapabilities } from './latch-harness/generated.ts';
import { latchChildEnvironment } from './latch-environment.ts';
import { LatchSessionCommandError } from './latch-session.ts';

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export type LatchResolveResult = {
  providerSessionId: string;
  requestId: string;
  choice: string;
  resolved: boolean;
};

export function probeLatchInteractionCapabilities({
  executable = 'latch',
  providerSessionId
}: {
  executable?: string | null;
  providerSessionId: string;
}): InteractionCapabilities {
  const sessionId = trimmed(providerSessionId);
  const bin = trimmed(executable) ?? 'latch';
  if (!sessionId) {
    return {
      sendMessage: false,
      sendKeys: false,
      resolve: false,
      canSend: { ok: false, reason: 'A Latch session id is required.' }
    };
  }
  const help = spawnSync(bin, ['send', '--help'], {
    encoding: 'utf8',
    shell: false,
    timeout: 5_000,
    env: latchChildEnvironment()
  });
  if (help.error || help.status !== 0) {
    const detail = (
      help.stderr ||
      help.stdout ||
      help.error?.message ||
      'latch send is unavailable'
    )
      .trim()
      .slice(0, 200);
    return {
      sendMessage: false,
      sendKeys: false,
      resolve: false,
      canSend: { ok: false, reason: detail || 'latch send is not available on this Latch build.' }
    };
  }
  return {
    sendMessage: /--message\b/.test(`${help.stdout}\n${help.stderr}`),
    sendKeys: /--keys\b/.test(`${help.stdout}\n${help.stderr}`),
    resolve: /--resolve\b/.test(`${help.stdout}\n${help.stderr}`),
    canSend: { ok: true }
  };
}

export function resolveLatchInput({
  executable = 'latch',
  providerSessionId,
  requestId,
  choice
}: {
  executable?: string | null;
  providerSessionId: string;
  requestId: string;
  choice: string;
}): LatchResolveResult {
  const sessionId = trimmed(providerSessionId);
  const id = trimmed(requestId);
  const selected = trimmed(choice);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  if (!id) throw new LatchSessionCommandError('A request id is required.');
  if (!selected) throw new LatchSessionCommandError('A resolve choice is required.');
  const capabilities = probeLatchInteractionCapabilities({
    executable,
    providerSessionId: sessionId
  });
  if (!capabilities.resolve || !capabilities.canSend.ok) {
    throw new LatchSessionCommandError(
      capabilities.canSend.reason || 'This Latch session cannot resolve a pending prompt.'
    );
  }
  const bin = trimmed(executable) ?? 'latch';
  const result = spawnSync(bin, ['send', sessionId, '--resolve', `${id}=${selected}`, '--json'], {
    encoding: 'utf8',
    shell: false,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: latchChildEnvironment()
  });
  if (result.error) throw new LatchSessionCommandError(result.error.message);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status ?? 'unknown'}`)
      .trim()
      .slice(0, 500);
    throw new LatchSessionCommandError(detail || 'latch send --resolve failed.');
  }
  return {
    providerSessionId: sessionId,
    requestId: id,
    choice: selected,
    resolved: true
  };
}
