#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CREDENTIALS_DIR = path.join(os.homedir(), '.ovld');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');

/**
 * @typedef {{ access_token: string, platform_url: string, user_email?: string }} Credentials
 */

/** @returns {Credentials | null} */
export function loadCredentials() {
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @param {Credentials} data */
export function saveCredentials(data) {
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function clearCredentials() {
  try {
    fs.unlinkSync(CREDENTIALS_FILE);
  } catch {
    // Already gone
  }
}

/**
 * Resolve the platform URL and agent token from credentials file or env vars.
 * @returns {{ platformUrl: string, agentToken: string }}
 */
export function resolveAuth() {
  const creds = loadCredentials();
  return {
    platformUrl:
      creds?.platform_url ?? process.env.PLATFORM_URL ?? 'http://localhost:3000',
    agentToken:
      creds?.access_token ?? process.env.AGENT_TOKEN ?? 'overlord-local-dev-token'
  };
}
