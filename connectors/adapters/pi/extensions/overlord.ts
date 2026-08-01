import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';

const missionId = process.env.MISSION_ID ?? process.env.OVERLORD_MISSION_ID ?? '';
const executionRequestId = process.env.OVERLORD_EXECUTION_REQUEST_ID ?? '';
const sessionKey = process.env.SESSION_KEY ?? '';
const channelId = process.env.OVERLORD_SESSION_CHANNEL_ID ?? '';

/**
 * Pi has no native permission prompt. Remote gating is therefore deliberately fail-open and
 * disabled unless both launch-policy values are explicitly enabled. The runner is responsible
 * for setting the workspace ceiling and project opt-in only after the project consent copy has
 * named the fail-open deadline; an extension must never broaden that policy on its own.
 */
function piRemoteDecisionsEnabled(): boolean {
  return (
    process.env.OVERLORD_PI_REMOTE_DECISIONS === 'enabled' &&
    process.env.OVERLORD_PI_PROJECT_REMOTE_DECISIONS === 'enabled'
  );
}

function externalSessionId(ctx: ExtensionContext): string | null {
  const id = ctx.sessionManager.getSessionId().trim();
  return id || null;
}

async function cacheNativeSession(ctx: ExtensionContext): Promise<void> {
  if (!missionId) return;
  const sessionId = externalSessionId(ctx);
  if (!sessionId) return;

  const key = createHash('sha256').update(`${ctx.cwd}\0${missionId}\0pi`).digest('hex');
  const directory = path.join(homedir(), '.ovld', 'native-sessions');

  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, key),
    JSON.stringify({ agent: 'pi', missionId, externalSessionId: sessionId }),
    'utf8'
  );
}

type PiToolCall = {
  toolName?: unknown;
  toolCallId?: unknown;
  input?: unknown;
};

/**
 * `pi.exec` intentionally exposes no stdin option. Keep the narrow native payload in an
 * owner-only temporary file for one CLI invocation, then unlink it in `finally`. This is the
 * only Pi-specific transport accommodation; the CLI still owns scope gating, normalization,
 * channel credentials, leases, and every network request.
 */
async function withPiPayloadFile<T>(
  payload: Record<string, unknown>,
  callback: (payloadFile: string) => Promise<T>
): Promise<T | null> {
  let directory: string | null = null;
  try {
    directory = await mkdtemp(path.join(tmpdir(), 'ovld-pi-agent-session-'));
    await chmod(directory, 0o700);
    const payloadFile = path.join(directory, 'payload.json');
    await writeFile(payloadFile, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    return await callback(payloadFile);
  } catch {
    return null;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

function sessionPayload({
  type,
  ctx,
  event
}: {
  type: 'input' | 'tool_call' | 'agent_start';
  ctx: ExtensionContext;
  event?: unknown;
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type,
    session_id: externalSessionId(ctx),
    cwd: ctx.cwd
  };
  if (type === 'input') {
    const input = event as { text?: unknown } | undefined;
    if (typeof input?.text === 'string') base.prompt = input.text;
  }
  if (type === 'tool_call') {
    const tool = event as PiToolCall | undefined;
    if (typeof tool?.toolName === 'string') base.tool_name = tool.toolName;
    if (typeof tool?.toolCallId === 'string') {
      base.tool_use_id = tool.toolCallId;
      base.request_id = tool.toolCallId;
    }
    if (tool?.input && typeof tool.input === 'object') base.tool_input = tool.input;
  }
  return base;
}

async function publishAgentSessionEvent(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  type: 'input' | 'tool_call' | 'agent_start',
  event?: unknown
): Promise<void> {
  if (!channelId) return;
  await withPiPayloadFile(sessionPayload({ type, ctx, event }), payloadFile =>
    pi.exec('ovld', ['agent-session', 'event', '--agent', 'pi', '--payload-file', payloadFile], {
      timeout: 5_000
    })
  );
}

async function requestPiDecision(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  event: PiToolCall
): Promise<{ block: true; reason?: string } | null> {
  if (!channelId || !piRemoteDecisionsEnabled()) return null;
  const result = await withPiPayloadFile(
    sessionPayload({ type: 'tool_call', ctx, event }),
    payloadFile =>
      // 35 seconds yields a 28 second waiter deadline in the shared callback runtime. That is
      // intentionally shorter than the documented active default and, on timeout/loss, returns
      // no decision — Pi then allows the tool because it has no native prompt to release to.
      pi.exec(
        'ovld',
        ['agent-session', 'request', '--agent', 'pi', '--payload-file', payloadFile],
        {
          timeout: 35_000
        }
      )
  );
  if (!result || result.code !== 0 || !result.stdout.trim()) return null;
  try {
    const decision = JSON.parse(result.stdout) as { block?: unknown; reason?: unknown };
    return decision.block === true
      ? { block: true, ...(typeof decision.reason === 'string' ? { reason: decision.reason } : {}) }
      : null;
  } catch {
    return null;
  }
}

/**
 * Claim one pending Overlord instruction and deliver it via sendUserMessage.
 *
 * The CLI owns transport and the lease; this extension only calls the in-process API and
 * confirms emission afterwards. Delivered is reported only after sendUserMessage succeeds.
 */
async function drainInbox(pi: ExtensionAPI): Promise<void> {
  if (!channelId) return;
  try {
    const result = await pi.exec('ovld', ['agent-session', 'inbox', '--agent', 'pi']);
    const raw =
      typeof result === 'string'
        ? result
        : result && typeof result === 'object' && 'stdout' in result
          ? String((result as { stdout: unknown }).stdout ?? '')
          : String(result ?? '');
    const line =
      raw
        .trim()
        .split('\n')
        .find(entry => entry.startsWith('{')) ?? '';
    if (!line) return;
    const parsed = JSON.parse(line) as {
      inputId?: string;
      leaseId?: string;
      body?: string;
      deliverAs?: 'steer' | 'followUp';
    };
    if (!parsed.inputId || !parsed.leaseId || !parsed.body) return;
    pi.sendUserMessage(parsed.body, {
      deliverAs: parsed.deliverAs === 'followUp' ? 'followUp' : 'steer'
    });
    await pi.exec('ovld', [
      'agent-session',
      'inbox',
      '--agent',
      'pi',
      '--confirm',
      parsed.inputId,
      '--lease-id',
      parsed.leaseId
    ]);
  } catch {
    // Extension failures must never crash the agent. A missed inject surfaces as Pending.
  }
}

export default function overlordPiExtension(pi: ExtensionAPI): void {
  let skipFirstInput = Boolean(missionId && executionRequestId);
  let turnIndex = 0;

  pi.on('session_start', (_event, ctx) => {
    void cacheNativeSession(ctx).catch(() => {});
    void drainInbox(pi);
  });

  pi.on('agent_start', (_event, ctx) => {
    void cacheNativeSession(ctx).catch(() => {});
    void publishAgentSessionEvent(pi, ctx, 'agent_start').catch(() => {});
  });

  pi.on('input', (event, ctx) => {
    void cacheNativeSession(ctx).catch(() => {});
    void drainInbox(pi);

    if (event.source !== 'extension' && event.text.trim().length > 0) {
      void publishAgentSessionEvent(pi, ctx, 'input', event).catch(() => {});
    }

    if (!missionId || event.source === 'extension' || event.text.trim().length === 0) {
      return { action: 'continue' };
    }
    if (skipFirstInput) {
      skipFirstInput = false;
      return { action: 'continue' };
    }

    const args = [
      'protocol',
      'hook-event',
      '--hook-type',
      'UserPromptSubmit',
      '--mission-id',
      missionId,
      '--prompt',
      event.text,
      '--turn-index',
      String(++turnIndex)
    ];
    const sessionId = externalSessionId(ctx);
    if (sessionId) args.push('--external-session-id', sessionId);
    if (sessionKey) args.push('--session-key', sessionKey);

    void pi.exec('ovld', args).catch(() => {});
    return { action: 'continue' };
  });

  pi.on('tool_call', async (event, ctx) => {
    const tool = event as PiToolCall;
    // Observation remains independent of the remote-decision policy. The extension does not
    // await it, so telemetry loss can never delay a tool call.
    void publishAgentSessionEvent(pi, ctx, 'tool_call', tool).catch(() => {});
    const decision = await requestPiDecision(pi, ctx, tool);
    return decision ?? {};
  });
}
