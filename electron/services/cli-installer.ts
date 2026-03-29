import { app } from 'electron';
import fs from 'fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

const WRAPPER_SCRIPT = `#!/bin/sh
# Overlord CLI wrapper - installed by Overlord desktop app
exec node "%CLI_PATH%" "$@"
`;

export type CliInstallResult =
  | { ok: true; installPath: string; pathInstruction: string }
  | { ok: false; error: string };

type CliInstallStatus = {
  installed: boolean;
  installPath?: string;
  isStale?: boolean;
  version: string;
  installedVersion?: string | null;
  latestVersion?: string | null;
  updateAvailable?: boolean;
};

const USER_LOCAL_BIN = path.join(os.homedir(), '.local', 'bin');

function getPathEntries(): string[] {
  const value = process.env.PATH ?? '';
  return value
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function isWritableDirectory(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    if (!fs.statSync(dir).isDirectory()) return false;
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isGlobalBinCandidate(dir: string): boolean {
  if (!path.isAbsolute(dir)) return false;
  if (dir.includes('node_modules')) return false;
  if (dir.startsWith('/tmp')) return false;
  if (dir.startsWith('/private/tmp')) return false;
  return path.basename(dir) === 'bin';
}

function getInstallDirCandidates(): string[] {
  const primaryCandidates =
    process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : ['/usr/local/bin'];
  const pathCandidates = getPathEntries().filter(isGlobalBinCandidate);
  const fallbackCandidates = [USER_LOCAL_BIN, path.join(os.homedir(), 'bin')];
  return [...new Set([...primaryCandidates, ...pathCandidates, ...fallbackCandidates])];
}

function resolveInstallDir(): string {
  const writableCandidate = getInstallDirCandidates().find(isWritableDirectory);
  if (writableCandidate) return writableCandidate;
  return USER_LOCAL_BIN;
}

function getBundledCliPath(): string | null {
  const isPackaged = app.isPackaged;
  if (!isPackaged) {
    // Dev: CLI source lives in packages/overlord-cli
    return path.join(app.getAppPath(), 'packages', 'overlord-cli', 'bin', 'ovld.mjs');
  }
  const appPath = app.getAppPath();
  const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
  const cliPath = path.join(unpackedPath, 'packages', 'overlord-cli', 'bin', 'ovld.mjs');
  return fs.existsSync(cliPath) ? cliPath : null;
}

function isPathConfiguredFor(dir: string): boolean {
  return getPathEntries().includes(dir);
}

async function readInstalledCliVersion(wrapperPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(wrapperPath, ['version'], {
      timeout: 2500,
      env: process.env
    });
    const match = stdout.match(/Overlord CLI ([^\s]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function fetchLatestCliVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch('https://registry.npmjs.org/overlord-cli/latest', {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { version?: unknown };
    return typeof payload.version === 'string' ? payload.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCliInstallStatus(): Promise<CliInstallStatus> {
  const version = app.getVersion();
  const bundledPath = getBundledCliPath();
  const latestVersion = await fetchLatestCliVersion();

  for (const installDir of getInstallDirCandidates()) {
    const wrapperPath = path.join(installDir, 'ovld');
    if (fs.existsSync(wrapperPath)) {
      let isStale = false;
      if (bundledPath) {
        try {
          const content = fs.readFileSync(wrapperPath, 'utf8');
          isStale = !content.includes(bundledPath);
        } catch {
          isStale = true;
        }
      }
      const installedVersion = await readInstalledCliVersion(wrapperPath);
      return {
        installed: true,
        installPath: wrapperPath,
        isStale,
        version,
        installedVersion,
        latestVersion,
        updateAvailable: Boolean(
          latestVersion && installedVersion && latestVersion !== installedVersion
        )
      };
    }
  }

  return { installed: false, version, latestVersion, updateAvailable: false };
}

export async function installCli(): Promise<CliInstallResult> {
  const bundledPath = getBundledCliPath();
  if (!bundledPath || !fs.existsSync(bundledPath)) {
    return { ok: false, error: 'CLI not found in app bundle.' };
  }

  const installDir = resolveInstallDir();
  const wrapperPath = path.join(installDir, 'ovld');

  try {
    if (!fs.existsSync(installDir)) {
      fs.mkdirSync(installDir, { recursive: true });
    }

    const script = WRAPPER_SCRIPT.replace('%CLI_PATH%', bundledPath);
    fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to install: ${message}` };
  }

  const pathInstruction = isPathConfiguredFor(installDir)
    ? `Installed globally at ${installDir}. You can now run ovld from any repository.`
    : installDir === USER_LOCAL_BIN
      ? 'Installed to ~/.local/bin. Add it to PATH if needed (e.g. in ~/.zshrc: export PATH="$HOME/.local/bin:$PATH").'
      : `Installed to ${installDir}. Ensure it is included in your PATH.`;

  return {
    ok: true,
    installPath: wrapperPath,
    pathInstruction
  };
}
