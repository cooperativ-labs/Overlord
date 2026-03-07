#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RUNTIME_ENV_ALLOWLIST } from './electron-runtime-allowlist.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GENERATED_ENV_PATH = resolve(ROOT, 'electron/_prod-env.generated.ts');

const FORBIDDEN_KEY_PATTERNS = [
  /\bSUPABASE_SECRET_KEY\b/,
  /\bSUPABASE_SERVICE_ROLE_KEY\b/,
  /\bRESEND(?:_API_KEY)?\b/,
  /\bAPPLE_APP_SPECIFIC_PASSWORD\b/
];

const FORBIDDEN_VALUE_PREFIXES = ['sb_secret_', 'sb_service_role_'];

function fail(message) {
  console.error(`[security-check] ${message}`);
  process.exit(1);
}

function isTracked(filePath) {
  try {
    execSync(`git ls-files --error-unmatch ${JSON.stringify(filePath)}`, {
      cwd: ROOT,
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

if (!RUNTIME_ENV_ALLOWLIST || RUNTIME_ENV_ALLOWLIST.length === 0) {
  fail('RUNTIME_ENV_ALLOWLIST is empty or missing in scripts/electron-runtime-allowlist.mjs.');
}

if (isTracked('electron/_prod-env.generated.ts')) {
  fail('electron/_prod-env.generated.ts must not be tracked in git.');
}

if (existsSync(GENERATED_ENV_PATH)) {
  const generatedEnvContent = readFileSync(GENERATED_ENV_PATH, 'utf8');
  for (const pattern of FORBIDDEN_KEY_PATTERNS) {
    if (pattern.test(generatedEnvContent)) {
      fail(`Generated runtime env contains forbidden key: ${pattern.source}`);
    }
  }
  for (const prefix of FORBIDDEN_VALUE_PREFIXES) {
    if (generatedEnvContent.includes(prefix)) {
      fail(`Generated runtime env contains forbidden secret prefix: ${prefix}`);
    }
  }
}

console.log('[security-check] Electron runtime env checks passed.');
