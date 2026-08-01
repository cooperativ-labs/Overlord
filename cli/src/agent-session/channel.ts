import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

import { resolveGlobalDataDir } from '../config.js';

/**
 * The channel bootstrap: where the scoped credential lives locally, and where it must not.
 *
 * A launched agent needs the credential for the whole life of its session, which means it has
 * to survive somewhere the launched process can reach. There are three plausible places and
 * only one acceptable one:
 *
 *  - **argv** — visible in `ps` to every process on the machine. Never.
 *  - **the launch script in `<checkout>/.overlord/tmp`** — checkout-local, which means it can
 *    be committed, copied into a worktree, rsynced to a colleague, or picked up by a backup.
 *    The terminal-window launch path writes such a script, so this is a real temptation and
 *    not a hypothetical one. Never.
 *  - **an owner-only file under the global data directory, keyed by channel id** — outside
 *    every checkout, `0600`, atomically written, and deleted when the channel ends. This one.
 *
 * The environment variable `OVERLORD_SESSION_CHANNEL_TOKEN` remains a supported *input*,
 * because a virtual gateway realizes its bootstrap directly into the target environment and has
 * no local disk to stage through. When it is present it wins; otherwise the cache answers.
 *
 * Deleting the cache file is cleanup, not a security control. The server revokes the credential
 * when the channel ends, so a cached copy that outlives its channel is already inert.
 */

export const SESSION_CHANNEL_ID_ENV = 'OVERLORD_SESSION_CHANNEL_ID';
export const SESSION_CHANNEL_TOKEN_ENV = 'OVERLORD_SESSION_CHANNEL_TOKEN';
export const SESSION_CHANNEL_LAUNCH_KIND_ENV = 'OVERLORD_SESSION_LAUNCH_KIND';
export const SESSION_CHANNEL_LAUNCH_PROMPT_ENV = 'OVERLORD_SESSION_LAUNCH_PROMPT_ID';

export type ChannelBootstrap = {
  channelId: string;
  token: string;
  source: 'env' | 'cache';
};

function credentialDir(): string {
  return path.join(resolveGlobalDataDir(), 'agent-session-channels');
}

/**
 * Channel ids are hashed into the filename rather than used directly.
 *
 * Not because a channel id is secret — it is not — but because it keeps the directory listing
 * from being an enumerable map of "which missions has this machine run", readable by anything
 * that can stat the directory even if it cannot read the files.
 */
function credentialPath(channelId: string): string {
  const key = createHash('sha256').update(channelId).digest('hex');
  return path.join(credentialDir(), key);
}

export function writeChannelCredential({
  channelId,
  token,
  expiresAt = null
}: {
  channelId: string;
  token: string;
  expiresAt?: string | null;
}): void {
  const dir = credentialDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // A pre-existing directory with wider permissions on a platform that refuses chmod is
    // reported by `ovld doctor`, not repaired by force here.
  }
  const filePath = credentialPath(channelId);
  // Write-then-rename so a reader never observes a half-written credential, and create the
  // temp file with 0600 from the start rather than widening and then narrowing it.
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify({ channelId, token, expiresAt }), { mode: 0o600 });
  renameSync(tempPath, filePath);
}

export function readChannelCredential(channelId: string): string | null {
  try {
    const filePath = credentialPath(channelId);
    if (!existsSync(filePath)) return null;
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as {
      channelId?: unknown;
      token?: unknown;
    };
    if (parsed.channelId !== channelId) return null;
    return typeof parsed.token === 'string' && parsed.token.trim() ? parsed.token.trim() : null;
  } catch {
    return null;
  }
}

/** Remove the local cache for a channel. Called on clean channel end and on auth failure. */
export function removeChannelCredential(channelId: string): void {
  try {
    rmSync(credentialPath(channelId), { force: true });
  } catch {
    // Nothing to do: the server has already revoked the credential this file names.
  }
}

/**
 * Resolve the bootstrap for the current process, or `null`.
 *
 * `null` is the normal, silent outcome for every session Overlord did not launch, and it is the
 * first half of the scope gate: no channel means no credential means no call, and the adapter
 * exits having done nothing observable.
 */
export function resolveChannelBootstrap(
  env: NodeJS.ProcessEnv = process.env
): ChannelBootstrap | null {
  const channelId = env[SESSION_CHANNEL_ID_ENV]?.trim();
  if (!channelId) return null;

  const envToken = env[SESSION_CHANNEL_TOKEN_ENV]?.trim();
  if (envToken) return { channelId, token: envToken, source: 'env' };

  const cached = readChannelCredential(channelId);
  if (cached) return { channelId, token: cached, source: 'cache' };

  return null;
}
