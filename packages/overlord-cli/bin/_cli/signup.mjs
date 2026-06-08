#!/usr/bin/env node
/* global console, fetch, process, URL */

import os from 'node:os';
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

import { resolveLoginPlatformUrl } from './auth.mjs';
import { buildAuthHeaders, loadCredentials, loadRuntime, saveCredentials } from './credentials.mjs';

// ---------------------------------------------------------------------------
// Small parsing / prompting helpers
// ---------------------------------------------------------------------------

export function parseSignupFlags(args = []) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags[key] = args[i + 1];
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function flagString(flags, name) {
  const value = flags[name];
  return typeof value === 'string' ? value.trim() : '';
}

async function promptForValue(question, defaultValue = '') {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return defaultValue;
  const rl = readline.createInterface({ input, output });
  try {
    return await new Promise(resolve => {
      const suffix = defaultValue ? ` (${defaultValue})` : '';
      rl.question(`${question}${suffix}: `, answer => resolve(answer.trim() || defaultValue));
    });
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

function resolveSignupContext() {
  const storedCredentials = loadCredentials();
  const platformUrl = resolveLoginPlatformUrl(null, storedCredentials?.platform_url ?? null);
  const runtime = loadRuntime(platformUrl);
  const localSecret = runtime?.local_secret ?? process.env.OVERLORD_LOCAL_SECRET ?? '';
  return { platformUrl, localSecret };
}

async function postJson(platformUrl, pathName, localSecret, body, accessToken = '') {
  let res;
  try {
    res = await fetch(`${platformUrl}${pathName}`, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(accessToken, localSecret),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    const cause = error?.cause;
    const detail = [cause?.code, cause?.message].filter(Boolean).join(': ');
    throw new Error(`Request to ${pathName} failed: ${detail || (error?.message ?? error)}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error ?? `${pathName} failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

export function requestCliSignup(platformUrl, localSecret, { email, name, password, inviteToken }) {
  return postJson(platformUrl, '/api/auth/cli-signup/request', localSecret, {
    email,
    name,
    ...(password ? { password } : {}),
    ...(inviteToken ? { inviteToken } : {})
  });
}

export function verifyCliSignup(platformUrl, localSecret, { email, token, password }) {
  return postJson(platformUrl, '/api/auth/cli-signup/verify', localSecret, {
    email,
    token,
    ...(password ? { password } : {})
  });
}

export function requestCliLogin(platformUrl, localSecret, { email }) {
  return postJson(platformUrl, '/api/auth/cli-login/request', localSecret, { email });
}

export function verifyCliLogin(platformUrl, localSecret, { email, token }) {
  return postJson(platformUrl, '/api/auth/cli-login/verify', localSecret, { email, token });
}

export function mintAgentToken(platformUrl, localSecret, accessToken, label) {
  return postJson(platformUrl, '/api/auth/agent-token', localSecret, { label }, accessToken);
}

// ---------------------------------------------------------------------------
// Credential persistence after a verified session
// ---------------------------------------------------------------------------

function defaultAgentTokenLabel() {
  const host = os.hostname() || 'cli';
  return `CLI: ${host}`.slice(0, 80);
}

/**
 * Persist a verified Supabase session and, unless suppressed, mint and store a
 * durable `oat_…` agent token as the preferred future credential.
 *
 * @returns {Promise<{ agentToken: string | null }>}
 */
export async function persistVerifiedSession(
  platformUrl,
  localSecret,
  session,
  { mintToken = true, label = defaultAgentTokenLabel(), logger = console } = {}
) {
  const resolvedPlatformUrl = session.platform_url ?? platformUrl;
  let agentToken = null;

  if (mintToken) {
    try {
      const minted = await mintAgentToken(
        resolvedPlatformUrl,
        localSecret,
        session.access_token,
        label
      );
      agentToken = typeof minted.token === 'string' ? minted.token : null;
    } catch (error) {
      logger.log(
        `\nWarning: could not mint a durable agent token (${error instanceof Error ? error.message : error}).`
      );
      logger.log('Saved the Supabase session instead; re-run `ovld auth login --email` to retry.');
    }
  }

  saveCredentials({
    ...(agentToken ? { agent_token: agentToken } : {}),
    access_token: session.access_token,
    access_token_expires_at: session.access_token_expires_at ?? undefined,
    refresh_token: session.refresh_token,
    platform_url: resolvedPlatformUrl,
    ...(session.email ? { user_email: session.email } : {})
  });

  return { agentToken };
}

// ---------------------------------------------------------------------------
// Full interactive signup flow (shared with `ovld onboard --email`)
// ---------------------------------------------------------------------------

/**
 * Run CLI account creation end to end: request a confirmation email, collect the
 * code, verify it, then persist the session (and an agent token by default).
 * Returns the verified session so callers (e.g. onboarding) can keep using the
 * Supabase access token for follow-up provisioning.
 */
export async function runCliSignupFlow(
  flags,
  { logger = console, mintToken = !(flags['no-agent-token'] === true) } = {}
) {
  const email = flagString(flags, 'email') || (await promptForValue('Email'));
  if (!email) throw new Error('An email address is required (--email).');

  const inferredName = os.userInfo().username || 'Agent';
  const name = flagString(flags, 'name') || (await promptForValue('Your name', inferredName));
  if (!name) throw new Error('A name is required (--name).');

  const password = flagString(flags, 'password') || undefined;
  const inviteToken = flagString(flags, 'invite') || flagString(flags, 'invite-code') || undefined;

  const { platformUrl, localSecret } = resolveSignupContext();

  logger.log(`\nCreating your Overlord account for ${email}...`);
  const requested = await requestCliSignup(platformUrl, localSecret, {
    email,
    name,
    password,
    inviteToken
  });

  logger.log(`We sent an 8-digit confirmation code to ${email}.`);
  const code = flagString(flags, 'code') || (await promptForValue('Enter confirmation code'));
  if (!code) throw new Error('A confirmation code is required to finish signup.');

  const session = await verifyCliSignup(platformUrl, localSecret, { email, token: code, password });

  const { agentToken } = await persistVerifiedSession(platformUrl, localSecret, session, {
    mintToken,
    logger
  });

  return { session, agentToken, platformUrl, localSecret, passwordless: requested.passwordless };
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

function printSignupHelp() {
  console.log(`ovld auth signup — create an Overlord account from the terminal

Usage:
  ovld auth signup --email <email> [--name <name>] [--password <password>]
  ovld auth signup request --email <email> --name <name> [--password <password>] [--json]
  ovld auth signup verify --email <email> --code <code> [--password <password>] [--json]

Flags:
  --email <email>       Email to create the account with (prompted if omitted).
  --name <name>         Display name (prompted if omitted).
  --password <password> Optional. Recommended: a password-manager-generated password.
                        Without one, signup uses an email code and future login is
                        via \`ovld auth login --email\`.
  --no-agent-token      Do not mint/store a durable oat_ agent token after signup.
  --code <code>         Provide the emailed code non-interactively (single-shot flow).
  --json                Machine-readable output (request/verify subcommands).

Creates the account only. To also create an organization, project, and link this
directory, use \`ovld onboard --email <email>\`.`);
}

async function runSignupRequest(flags) {
  const email = flagString(flags, 'email');
  const name = flagString(flags, 'name');
  if (!email || !name) {
    throw new Error('`ovld auth signup request` requires --email and --name.');
  }
  const password = flagString(flags, 'password') || undefined;
  const inviteToken = flagString(flags, 'invite') || flagString(flags, 'invite-code') || undefined;
  const { platformUrl, localSecret } = resolveSignupContext();
  const result = await requestCliSignup(platformUrl, localSecret, {
    email,
    name,
    password,
    inviteToken
  });

  if (flags.json === true) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(`Confirmation code sent to ${email}.`);
  console.log('Finish with: ovld auth signup verify --email ' + email + ' --code <code>');
}

async function runSignupVerify(flags) {
  const email = flagString(flags, 'email');
  const token = flagString(flags, 'code') || flagString(flags, 'token');
  if (!email || !token) {
    throw new Error('`ovld auth signup verify` requires --email and --code.');
  }
  const password = flagString(flags, 'password') || undefined;
  const { platformUrl, localSecret } = resolveSignupContext();
  const session = await verifyCliSignup(platformUrl, localSecret, { email, token, password });
  const mintToken = !(flags['no-agent-token'] === true);
  const { agentToken } = await persistVerifiedSession(platformUrl, localSecret, session, {
    mintToken
  });

  if (flags.json === true) {
    console.log(JSON.stringify({ ok: true, email, agentTokenMinted: Boolean(agentToken) }));
    return;
  }
  console.log('Account confirmed and credentials saved.');
  if (agentToken) console.log('A durable agent token was minted and stored for headless use.');
}

export async function runAuthSignupCommand(args = []) {
  const [maybeSub, ...rest] = args;

  if (maybeSub === 'help' || maybeSub === '--help' || maybeSub === '-h') {
    printSignupHelp();
    return;
  }

  if (maybeSub === 'request') {
    await runSignupRequest(parseSignupFlags(rest));
    return;
  }
  if (maybeSub === 'verify') {
    await runSignupVerify(parseSignupFlags(rest));
    return;
  }

  // Single-shot interactive flow: `ovld auth signup --email ...`
  const flags = parseSignupFlags(args);
  const { agentToken, passwordless } = await runCliSignupFlow(flags);

  console.log('\nOverlord account created.');
  if (agentToken) {
    console.log('A durable agent token was minted and stored for headless use.');
  }
  if (passwordless) {
    console.log('No password was set — log back in later with `ovld auth login --email`.');
  }
  console.log('\nNext: run `ovld onboard --use-current-auth` to create a project in this directory.');
}

/**
 * `ovld auth login --email <email>`: send a fresh email OTP for an existing
 * account, verify it, and persist credentials (minting an agent token by default).
 */
export async function runEmailLogin(args = []) {
  const flags = parseSignupFlags(args);
  const email = flagString(flags, 'email') || (await promptForValue('Email'));
  if (!email) throw new Error('An email address is required (--email).');

  const { platformUrl, localSecret } = resolveSignupContext();

  // Split sub-flow support: `login request` / `login verify` are handled by the
  // caller; this entry point runs the interactive request+verify together.
  console.log(`\nSending a login code to ${email}...`);
  await requestCliLogin(platformUrl, localSecret, { email });

  const code =
    flagString(flags, 'code') ||
    flagString(flags, 'token') ||
    (await promptForValue('Enter login code'));
  if (!code) throw new Error('A login code is required.');

  const session = await verifyCliLogin(platformUrl, localSecret, { email, token: code });
  const mintToken = !(flags['no-agent-token'] === true);
  const { agentToken } = await persistVerifiedSession(platformUrl, localSecret, session, {
    mintToken
  });

  console.log('Logged in successfully.');
  if (agentToken) console.log('A durable agent token was minted and stored for headless use.');
}

/** Split login helpers for agents that pause between request and verify. */
export async function runEmailLoginRequest(args = []) {
  const flags = parseSignupFlags(args);
  const email = flagString(flags, 'email');
  if (!email) throw new Error('`ovld auth login request` requires --email.');
  const { platformUrl, localSecret } = resolveSignupContext();
  const result = await requestCliLogin(platformUrl, localSecret, { email });
  if (flags.json === true) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(`Login code sent to ${email}.`);
}

export async function runEmailLoginVerify(args = []) {
  const flags = parseSignupFlags(args);
  const email = flagString(flags, 'email');
  const token = flagString(flags, 'code') || flagString(flags, 'token');
  if (!email || !token) {
    throw new Error('`ovld auth login verify` requires --email and --code.');
  }
  const { platformUrl, localSecret } = resolveSignupContext();
  const session = await verifyCliLogin(platformUrl, localSecret, { email, token });
  const mintToken = !(flags['no-agent-token'] === true);
  const { agentToken } = await persistVerifiedSession(platformUrl, localSecret, session, {
    mintToken
  });
  if (flags.json === true) {
    console.log(JSON.stringify({ ok: true, email, agentTokenMinted: Boolean(agentToken) }));
    return;
  }
  console.log('Logged in successfully.');
  if (agentToken) console.log('A durable agent token was minted and stored for headless use.');
}
