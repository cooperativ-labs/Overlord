#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

import { authLoginViaDeviceFlow, resolveLoginPlatformUrl } from './auth.mjs';
import {
  buildAuthHeaders,
  loadCredentials,
  loadRuntime,
  saveCredentials
} from './credentials.mjs';
import { upsertLocalOverlordConfig } from './local-config.mjs';
import { readOrCreateDeviceFingerprint } from './runner.mjs';

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;

    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
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

function openBrowser(url) {
  try {
    if (process.platform === 'darwin') execFileSync('open', [url]);
    else if (process.platform === 'win32') execFileSync('cmd', ['/c', 'start', '', url]);
    else execFileSync('xdg-open', [url]);
  } catch {
    // Best effort. The URL is also printed.
  }
}

function trimFlag(flags, name) {
  const value = flags[name];
  return typeof value === 'string' ? value.trim() : '';
}

async function promptForValue(question, defaultValue = '') {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return defaultValue;
  }

  const rl = readline.createInterface({ input, output });
  try {
    return await new Promise((resolve, reject) => {
      const handleError = error => {
        rl.off('error', handleError);
        reject(error);
      };
      rl.once('error', handleError);
      const suffix = defaultValue ? ` (${defaultValue})` : '';
      rl.question(`${question}${suffix}: `, answer => {
        rl.off('error', handleError);
        const trimmed = answer.trim();
        resolve(trimmed || defaultValue);
      });
    });
  } finally {
    rl.close();
  }
}

async function promptForYes(question, defaultYes = true) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return defaultYes;
  }

  const rl = readline.createInterface({ input, output });
  try {
    return await new Promise((resolve, reject) => {
      const handleError = error => {
        rl.off('error', handleError);
        reject(error);
      };
      rl.once('error', handleError);
      const suffix = defaultYes ? 'Y/n' : 'y/N';
      rl.question(`${question} (${suffix}): `, answer => {
        rl.off('error', handleError);
        const normalized = answer.trim().toLowerCase();
        if (!normalized) resolve(defaultYes);
        else resolve(normalized === 'y' || normalized === 'yes');
      });
    });
  } finally {
    rl.close();
  }
}

function buildSignupUrl(platformUrl, verificationUri, name, invite) {
  const verificationUrl = new URL(verificationUri);
  const signupUrl = new URL('/signup', platformUrl);
  signupUrl.searchParams.set('next', `${verificationUrl.pathname}${verificationUrl.search}`);
  if (name) signupUrl.searchParams.set('name', name);
  // Pre-fill the invited email and accept the invite after signup (web fallback parity).
  if (invite) signupUrl.searchParams.set('invite', invite);
  return signupUrl.toString();
}

/**
 * Accept either a bare invitation token or a full `…/invite/<token>` URL pasted
 * from the invite email, returning the bare token (or '' when not provided).
 */
function normalizeInviteToken(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return '';
  const match = value.match(/\/invite\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : value;
}

async function completeCliOnboarding(platformUrl, localSecret, credentials, payload) {
  const res = await fetch(`${platformUrl}/api/auth/cli-onboarding`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(credentials.access_token, localSecret),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Onboarding setup failed (${res.status}): ${data.error ?? JSON.stringify(data)}`
    );
  }
  return data;
}

function buildWebProjectUrl(platformUrl, result) {
  const projectId = result?.project?.id;
  if (!projectId) return `${platformUrl}/u`;
  return `${platformUrl}/projects/${projectId}`;
}

export async function runOnboardCommand(args) {
  const flags = parseFlags(args);

  if (flags.help === true || flags.h === true || args[0] === 'help') {
    console.log(`Usage: ovld onboard [--name <name>] [--organization-name <name>] [--project-name <name>] [--directory <path>] [--invite <token|url>] [--yes] [--no-desktop]

Creates an Overlord account setup from the terminal:
  1. collects your name, organization, project, and repository directory
  2. opens browser signup/login and authorizes the CLI
  3. creates the organization/project, links this directory, and creates the first onboarding ticket
  4. opens the Desktop download page, or the web project when --no-desktop is used

With --invite <token>, joins the inviting organization (from an invite email)
with the invited role instead of creating a new organization; the organization
prompt is skipped. Accepts a bare token or a full /invite/<token> URL.

Run this from the repository you want Overlord agents to work in.`);
    return;
  }

  const inviteToken = normalizeInviteToken(flags.invite ?? flags['invite-code']);

  const directoryPath = path.resolve(trimFlag(flags, 'directory') || process.cwd());
  const directoryName = path.basename(directoryPath) || 'My project';
  const inferredName = os.userInfo().username || 'User';
  const name = trimFlag(flags, 'name') || (await promptForValue('Your name', inferredName));
  // On the invite path the org comes from the invitation, so skip the org prompt.
  const organizationName = inviteToken
    ? trimFlag(flags, 'organization-name')
    : trimFlag(flags, 'organization-name') || (await promptForValue('Organization name', name));
  const projectName =
    trimFlag(flags, 'project-name') || (await promptForValue('Project name', directoryName));

  if (!name || !projectName) {
    throw new Error('Name and project name are required.');
  }
  if (!inviteToken && !organizationName) {
    throw new Error('Organization name is required (or pass --invite <token> to join an org).');
  }

  const storedCredentials = loadCredentials();
  const platformUrl = resolveLoginPlatformUrl(null, storedCredentials?.platform_url ?? null);
  const runtime = loadRuntime(platformUrl);
  const localSecret = runtime?.local_secret ?? process.env.OVERLORD_LOCAL_SECRET ?? '';

  console.log('\nStarting Overlord onboarding in your browser.');
  console.log('Create an account or sign in, then approve the CLI authorization request.\n');

  const credentials = await authLoginViaDeviceFlow(platformUrl, localSecret, {
    browserOpener: verificationUri => {
      const signupUrl = buildSignupUrl(platformUrl, verificationUri, name, inviteToken);
      console.log(`  Signup URL: ${signupUrl}`);
      openBrowser(signupUrl);
    }
  });

  const resolvedPlatformUrl = credentials.platform_url ?? platformUrl;
  const deviceFingerprint = readOrCreateDeviceFingerprint(flags);
  const result = await completeCliOnboarding(resolvedPlatformUrl, localSecret, credentials, {
    name,
    ...(organizationName ? { organizationName } : {}),
    projectName,
    directoryPath,
    deviceFingerprint,
    deviceHostname: os.hostname(),
    devicePlatform: process.platform,
    ...(inviteToken ? { inviteToken } : {})
  });

  saveCredentials({
    access_token: credentials.access_token,
    access_token_expires_at: credentials.access_token_expires_at ?? undefined,
    refresh_token: credentials.refresh_token,
    organization_id: result.organization.organizationId,
    platform_url: resolvedPlatformUrl
  });

  try {
    const localConfig = await upsertLocalOverlordConfig({
      directoryPath,
      project: { id: result.project.id, name: result.project.name }
    });
    console.log(`\nWrote ${localConfig.filePath} (${localConfig.action}).`);
  } catch (error) {
    console.log(
      `\nWarning: could not update .overlord/project.json: ${error instanceof Error ? error.message : error}`
    );
  }

  console.log('\nOverlord setup complete.');
  console.log(`  Organization: ${result.organization.organizationName}`);
  if (result.organization.role) {
    console.log(`  Role: ${result.organization.role}`);
  }
  console.log(`  Project: ${result.project.name}`);
  console.log(`  Directory: ${directoryPath}`);
  if (result.ticket) {
    console.log(`  Onboarding ticket: ${result.ticket.reference ?? result.ticket.id}`);
  }

  const skipDesktop = flags['no-desktop'] === true || flags.desktop === 'false';
  const autoYes = flags.yes === true || flags.y === true;
  const shouldOpenDesktop =
    !skipDesktop &&
    (autoYes ||
      (await promptForYes(
        '\nRecommended: download Overlord Desktop for terminal launches and file-change tracking. Open downloads now?',
        true
      )));

  if (shouldOpenDesktop) {
    const downloadsUrl = `${resolvedPlatformUrl}/downloads`;
    console.log(`Opening ${downloadsUrl}`);
    openBrowser(downloadsUrl);
  } else {
    const webUrl = buildWebProjectUrl(resolvedPlatformUrl, result);
    console.log(`Opening ${webUrl}`);
    openBrowser(webUrl);
  }

  console.log('\nNext command from this repo:');
  console.log('  ovld prompt --objectives-json \'[{"objective":"Describe the work you want done"}]\'');
}
