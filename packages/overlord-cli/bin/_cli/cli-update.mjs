#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cliPackage = require('../../package.json');

const CURRENT_CLI_VERSION = typeof cliPackage.version === 'string' ? cliPackage.version : '0.0.0';
const CLI_PACKAGE_NAME =
  typeof cliPackage.name === 'string' && cliPackage.name ? cliPackage.name : 'overlord-cli';

const ORANGE = '\x1b[38;5;208m';
const RESET = '\x1b[0m';

function colorizeOrange(text) {
  return `${ORANGE}${text}${RESET}`;
}

export function getCurrentCliVersion() {
  return CURRENT_CLI_VERSION;
}

export function getCliPackageName() {
  return CLI_PACKAGE_NAME;
}

export async function fetchLatestCliVersion({
  fetchImpl = fetch,
  packageName = CLI_PACKAGE_NAME,
  timeoutMs = 2500
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`https://registry.npmjs.org/${packageName}/latest`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) return null;

    const payload = await response.json();
    return typeof payload?.version === 'string' ? payload.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkForCliUpdate(options = {}) {
  const currentVersion = options.currentVersion ?? CURRENT_CLI_VERSION;
  const latestVersion = await fetchLatestCliVersion(options);
  if (!latestVersion || latestVersion === currentVersion) return null;
  return latestVersion;
}

export function formatCliUpdateNotice(latestVersion, { currentVersion = CURRENT_CLI_VERSION } = {}) {
  return `New Overlord CLI version available: v${latestVersion} (installed v${currentVersion}). Run \`ovld update\` to update via npm.`;
}

export function printCliUpdateNotice(
  latestVersion,
  { currentVersion = CURRENT_CLI_VERSION, stream = process.stderr } = {}
) {
  if (!latestVersion) return false;
  stream.write(`${colorizeOrange(formatCliUpdateNotice(latestVersion, { currentVersion }))}\n`);
  return true;
}

export async function runCliUpdateCommand({
  currentVersion = CURRENT_CLI_VERSION,
  fetchLatestVersionFn = fetchLatestCliVersion,
  logger = console,
  npmCommand = 'npm',
  packageName = CLI_PACKAGE_NAME,
  spawnSyncImpl = spawnSync
} = {}) {
  const latestVersion = await fetchLatestVersionFn({ currentVersion, packageName });

  if (latestVersion && latestVersion === currentVersion) {
    logger.log(`Overlord CLI ${currentVersion} is already the latest version.`);
    return { alreadyLatest: true, currentVersion, latestVersion };
  }

  const target = `${packageName}@latest`;
  if (latestVersion) {
    logger.log(`Updating Overlord CLI ${currentVersion} -> ${latestVersion} via npm...`);
  } else {
    logger.log(`Updating Overlord CLI via npm...`);
  }

  const result = spawnSyncImpl(npmCommand, ['install', '-g', target], {
    env: process.env,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`\`${npmCommand} install -g ${target}\` exited with status ${result.status}.`);
  }

  if (typeof result.signal === 'string') {
    throw new Error(`\`${npmCommand} install -g ${target}\` was terminated by ${result.signal}.`);
  }

  if (latestVersion) {
    logger.log(`Overlord CLI updated to v${latestVersion}.`);
  } else {
    logger.log('Overlord CLI update complete. Run `ovld version` to confirm the installed version.');
  }

  return { alreadyLatest: false, currentVersion, latestVersion, result };
}
