import { resolveNativeSessionId } from '../native-session.js';

import { type ChannelBootstrap, resolveChannelBootstrap } from './channel.js';

/**
 * The scope gate.
 *
 * Every adapter entry point begins here, and the ordering inside it is the security property,
 * not an optimization. **Scope resolution runs before logging, interpreter spawn, filesystem
 * write, or network access.** The only operations permitted before the gate succeeds are a
 * bounded stdin read and a lookup in already-known local state.
 *
 * The reason is the negative test in §7: an unbound session — someone's own `claude` in an
 * unrelated directory on a machine that happens to have Overlord installed — must produce no
 * request, no event, no network call, no subprocess, no log line, and no measurable delay. That
 * is not a nice-to-have. A connector that writes a log file in every session on the machine is
 * a connector people uninstall, and rightly.
 *
 * File-change callbacks apply the same rule before invoking the local-only
 * `ovld protocol capture-change` path. Keeping this gate as its own module gives
 * every adapter one explicit boundary to call rather than a convention to
 * remember.
 *
 * ## What is and is not an authority
 *
 * | Signal                  | Can locate a binding | Can create one | Can authorize |
 * | ----------------------- | -------------------- | -------------- | ------------- |
 * | Channel credential      | yes                  | yes            | **yes**       |
 * | Protocol session key    | yes                  | yes            | **yes**       |
 * | Native session id       | yes                  | no             | no            |
 * | Working directory       | yes                  | no             | no            |
 *
 * The bottom two rows are the ones that get this wrong in practice. A native session id is a
 * correlation alias: it answers "which harness conversation is this?", which is useful for
 * stitching events together and useless as a grant, since anything that can read a hook payload
 * can read one. The working directory answers "which project is this checkout?" — a different
 * question from "which session is this?", and a shared checkout with two agents running in it
 * makes the difference concrete rather than academic.
 */

export type AgentSessionScope = {
  channelId: string;
  token: string;
  /** Correlation only. Never presented as authorization. */
  nativeSessionId: string | null;
  credentialSource: ChannelBootstrap['source'];
};

/**
 * Resolve this process's agent-session scope, or `null`.
 *
 * `null` means "do nothing at all" — not "fall back to something broader". In particular there
 * is no fallback to the user's `USER_TOKEN`: a decision call that retried with a broader
 * credential would be a privilege escalation triggered by a network hiccup.
 *
 * This function performs no I/O beyond reading the environment and, at most, two owner-only
 * files under the global data directory that this machine wrote itself.
 */
export function resolveAgentSessionScope({
  agent,
  missionId,
  workingDirectory,
  env = process.env
}: {
  agent: string;
  missionId?: string | null;
  workingDirectory?: string;
  env?: NodeJS.ProcessEnv;
}): AgentSessionScope | null {
  const bootstrap = resolveChannelBootstrap(env);
  if (!bootstrap) return null;

  // Correlation lookup only, and only once we already hold a credential. Doing it before the
  // credential check would mean an unbound session touches the native-session cache — a read,
  // but still an observable act on behalf of a session nobody asked us to observe.
  let nativeSessionId: string | null = null;
  if (missionId) {
    const resolved = resolveNativeSessionId({
      agent,
      missionId,
      workingDirectory: workingDirectory ?? process.cwd(),
      env
    });
    nativeSessionId = typeof resolved === 'string' && resolved.trim() ? resolved.trim() : null;
  }

  return {
    channelId: bootstrap.channelId,
    token: bootstrap.token,
    nativeSessionId,
    credentialSource: bootstrap.source
  };
}

/**
 * True when this process could carry agent-session traffic at all.
 *
 * Cheap enough to call first in a hook path, and deliberately not a network call: the answer
 * for an unbound session must cost nothing and reveal nothing.
 */
export function hasAgentSessionScope(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveChannelBootstrap(env) !== null;
}
