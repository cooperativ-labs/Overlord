import { createHash, randomBytes } from 'node:crypto';

/**
 * The scoped session-channel credential.
 *
 * This is deliberately a *different* credential family from `out_…` USER_TOKENs and `sess_…`
 * protocol session keys, and the prefix is what makes that visible at a glance in a log line,
 * an environment dump, or a support ticket. A reviewer should never have to look up which of
 * three opaque strings they are holding.
 *
 * What it can do is narrow by construction: append events to one channel, create requests on
 * it, await their resolution, claim and acknowledge inputs, and heartbeat. What it cannot do
 * is read mission context, resolve a human decision, or perform any normal mission mutation —
 * those live behind a separate authentication family entirely, so there is no "scope check"
 * to get wrong. See `backend/agent-session-routes.ts`.
 *
 * Only the SHA-256 hash is ever stored. The raw secret is returned exactly once, at channel
 * creation, and travels only through environment, stdin, or an Authorization header — never
 * argv, URLs, descriptor files, events, diagnostics, or crash text.
 */
export const SESSION_CHANNEL_TOKEN_PREFIX = 'osc_';

export const SESSION_CHANNEL_TOKEN_HASH_ALGORITHM = 'sha256';

/**
 * How long a credential stays valid without a heartbeat.
 *
 * "Short-lived" here means *revocable with the channel*, not "expires halfway through a healthy
 * long-running agent". Every heartbeat pushes this expiry forward with the channel lease, so a
 * ten-hour session that keeps reporting liveness keeps working. What the bound actually buys is
 * that a credential harvested from a dead session's environment stops working within minutes.
 */
export const SESSION_CHANNEL_LEASE_SECONDS = 180;

/**
 * The absolute ceiling a lease renewal may never push past, measured from channel creation.
 *
 * Renewal without a ceiling is renewal forever, which is the property we are trying not to
 * have. A session still running at the ceiling is not broken — the credential simply stops,
 * the adapter degrades to the harness's own behavior, and nothing silently keeps authority it
 * was never meant to accumulate.
 */
export const SESSION_CHANNEL_ABSOLUTE_LIFETIME_SECONDS = 60 * 60 * 24;

export function hashSessionChannelToken(rawToken: string): string {
  return createHash(SESSION_CHANNEL_TOKEN_HASH_ALGORITHM).update(rawToken).digest('hex');
}

export function isSessionChannelToken(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(SESSION_CHANNEL_TOKEN_PREFIX);
}

export function generateSessionChannelToken(): {
  secret: string;
  prefix: string;
  hash: string;
} {
  const prefix = `${SESSION_CHANNEL_TOKEN_PREFIX}${randomBytes(4).toString('hex')}`;
  const secret = `${prefix}${randomBytes(32).toString('base64url')}`;
  return { secret, prefix, hash: hashSessionChannelToken(secret) };
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

/**
 * The renewed credential expiry: now + lease, clamped to the absolute ceiling.
 */
export function renewedExpiry({
  now,
  createdAt,
  leaseSeconds = SESSION_CHANNEL_LEASE_SECONDS
}: {
  now: string;
  createdAt: string;
  leaseSeconds?: number;
}): string {
  const ceiling = new Date(
    new Date(createdAt).getTime() + SESSION_CHANNEL_ABSOLUTE_LIFETIME_SECONDS * 1000
  );
  const renewed = new Date(new Date(now).getTime() + leaseSeconds * 1000);
  return (renewed < ceiling ? renewed : ceiling).toISOString();
}
