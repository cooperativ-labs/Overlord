import { app } from 'electron';
import fs from 'fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);
const REQUIRED_NODE_MAJOR = 20;
const WRAPPER_VERSION = 2;
const OVLD_HOME = path.join(os.homedir(), '.ovld');
const CLI_INSTALL_ROOT = path.join(OVLD_HOME, 'cli');

const WRAPPER_SCRIPT = `#!/bin/sh
# Overlord CLI wrapper - installed by Overlord desktop app
# ovld-wrapper-version: ${WRAPPER_VERSION}
DEFAULT_NODE_BIN=%NODE_BIN%
NODE_BIN="\${OVLD_NODE_BIN:-$DEFAULT_NODE_BIN}"
CLI_DIR=%CLI_DIR%

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Overlord CLI requires Node.js ${REQUIRED_NODE_MAJOR} or newer, but '$NODE_BIN' was not found." >&2
  exit 1
fi

NODE_MAJOR=$("$NODE_BIN" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
case "$NODE_MAJOR" in
  ''|*[!0-9]*)
    NODE_MAJOR=0
    ;;
esac

if [ "$NODE_MAJOR" -lt ${REQUIRED_NODE_MAJOR} ]; then
  NODE_VERSION=$("$NODE_BIN" -v 2>/dev/null || echo "unknown")
  echo "Overlord CLI requires Node.js ${REQUIRED_NODE_MAJOR} or newer. Found $NODE_VERSION. Update Node or set OVLD_NODE_BIN to a Node ${REQUIRED_NODE_MAJOR}+ binary." >&2
  exit 1
fi

exec "$NODE_BIN" "$CLI_DIR/bin/ovld.mjs" "$@"
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

type NodeRuntime = {
  binPath: string;
  source: 'env' | 'bundled' | 'path' | 'common';
  version: string;
};

function getPathEntries(): string[] {
  const value = process.env.PATH ?? '';
  return value
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
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

function getBundledNodeCandidates(): string[] {
  const candidates: string[] = [];
  const resourcesPath = process.resourcesPath;

  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'node', 'bin', 'node'));
    candidates.push(
      path.join(resourcesPath, 'node', `${process.platform}-${process.arch}`, 'bin', 'node')
    );
  }

  const appPath = app.getAppPath();
  const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
  candidates.push(path.join(unpackedPath, 'node', 'bin', 'node'));
  candidates.push(
    path.join(unpackedPath, 'node', `${process.platform}-${process.arch}`, 'bin', 'node')
  );

  return candidates;
}

function getCommonNodeCandidates(): string[] {
  const candidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    '/opt/local/bin/node',
    path.join(os.homedir(), '.volta', 'bin', 'node'),
    path.join(os.homedir(), '.asdf', 'shims', 'node'),
    path.join(os.homedir(), '.mise', 'shims', 'node'),
    path.join(os.homedir(), '.local', 'share', 'mise', 'shims', 'node')
  ];

  const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), '.nvm');
  const nvmVersionsDir = path.join(nvmDir, 'versions', 'node');
  try {
    const nvmCandidates = fs
      .readdirSync(nvmVersionsDir)
      .filter(entry => entry.startsWith('v'))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map(entry => path.join(nvmVersionsDir, entry, 'bin', 'node'));
    candidates.push(...nvmCandidates);
  } catch {
    // NVM is optional.
  }

  return candidates;
}

async function resolvePathNode(): Promise<string | null> {
  try {
    const command = process.platform === 'win32' ? 'where.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['node'] : ['-lc', 'command -v node'];
    const { stdout } = await execFileAsync(command, args, {
      env: process.env,
      timeout: 1000
    });
    return (
      stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(Boolean) ?? null
    );
  } catch {
    return null;
  }
}

async function getNodeVersion(binPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binPath, ['-v'], {
      env: process.env,
      timeout: 1500
    });
    const version = stdout.trim();
    return version || null;
  } catch {
    return null;
  }
}

function getNodeMajor(version: string): number {
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? 0 : major;
}

async function findCompatibleNodeRuntime(): Promise<NodeRuntime | null> {
  const pathNode = await resolvePathNode();
  const candidates: Array<{ binPath: string; source: NodeRuntime['source'] }> = [
    ...(process.env.OVLD_NODE_BIN
      ? [{ binPath: process.env.OVLD_NODE_BIN, source: 'env' as const }]
      : []),
    ...getBundledNodeCandidates().map(binPath => ({ binPath, source: 'bundled' as const })),
    ...(pathNode ? [{ binPath: pathNode, source: 'path' as const }] : []),
    ...getCommonNodeCandidates().map(binPath => ({ binPath, source: 'common' as const }))
  ];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.binPath)) continue;
    seen.add(candidate.binPath);

    const version = await getNodeVersion(candidate.binPath);
    if (version && getNodeMajor(version) >= REQUIRED_NODE_MAJOR) {
      return { ...candidate, version };
    }
  }

  return null;
}

function resolveInstallDir(): string {
  const writableCandidate = getInstallDirCandidates().find(isWritableDirectory);
  if (writableCandidate) return writableCandidate;
  return USER_LOCAL_BIN;
}

function getBundledCliDir(): string | null {
  const isPackaged = app.isPackaged;
  if (!isPackaged) {
    const cliDir = path.join(app.getAppPath(), 'packages', 'overlord-cli');
    return fs.existsSync(path.join(cliDir, 'bin', 'ovld.mjs')) ? cliDir : null;
  }
  const appPath = app.getAppPath();
  const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
  const cliDir = path.join(unpackedPath, 'packages', 'overlord-cli');
  return fs.existsSync(path.join(cliDir, 'bin', 'ovld.mjs')) ? cliDir : null;
}

function readCliVersion(cliDir: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(cliDir, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function getInstalledCliDir(version: string): string {
  return path.join(CLI_INSTALL_ROOT, `overlord-cli-${version}`);
}

function syncInstalledCliCopy(sourceCliDir: string, version: string): string {
  const targetCliDir = getInstalledCliDir(version);
  fs.mkdirSync(CLI_INSTALL_ROOT, { recursive: true });
  fs.cpSync(sourceCliDir, targetCliDir, {
    recursive: true,
    force: true
  });
  return targetCliDir;
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
  const bundledCliDir = getBundledCliDir();
  const bundledCliVersion = bundledCliDir ? readCliVersion(bundledCliDir) : null;
  const expectedCliDir = bundledCliVersion ? getInstalledCliDir(bundledCliVersion) : null;
  const latestVersion = await fetchLatestCliVersion();

  for (const installDir of getInstallDirCandidates()) {
    const wrapperPath = path.join(installDir, 'ovld');
    if (fs.existsSync(wrapperPath)) {
      let isStale = false;
      if (expectedCliDir) {
        try {
          const content = fs.readFileSync(wrapperPath, 'utf8');
          isStale =
            !content.includes(expectedCliDir) ||
            !content.includes(`ovld-wrapper-version: ${WRAPPER_VERSION}`) ||
            !content.includes('OVLD_NODE_BIN') ||
            !fs.existsSync(path.join(expectedCliDir, 'bin', 'ovld.mjs'));
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
  const bundledCliDir = getBundledCliDir();
  const bundledCliVersion = bundledCliDir ? readCliVersion(bundledCliDir) : null;
  if (!bundledCliDir || !bundledCliVersion) {
    return { ok: false, error: 'CLI not found in app bundle.' };
  }

  const installDir = resolveInstallDir();
  const wrapperPath = path.join(installDir, 'ovld');
  const installedCliDir = syncInstalledCliCopy(bundledCliDir, bundledCliVersion);
  const nodeRuntime = await findCompatibleNodeRuntime();
  if (!nodeRuntime) {
    return {
      ok: false,
      error: `Could not find Node.js ${REQUIRED_NODE_MAJOR} or newer. Install Node ${REQUIRED_NODE_MAJOR}+ or set OVLD_NODE_BIN to a compatible Node binary.`
    };
  }

  try {
    if (!fs.existsSync(installDir)) {
      fs.mkdirSync(installDir, { recursive: true });
    }

    const script = WRAPPER_SCRIPT.replace('%CLI_DIR%', shellQuote(installedCliDir)).replace(
      '%NODE_BIN%',
      shellQuote(nodeRuntime.binPath)
    );
    fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to install: ${message}` };
  }

  const pathInstruction = isPathConfiguredFor(installDir)
    ? `Installed globally at ${installDir}. You can now run ovld from any repository. It will use ${nodeRuntime.version} from ${nodeRuntime.binPath}.`
    : installDir === USER_LOCAL_BIN
      ? `Installed to ~/.local/bin. Add it to PATH if needed (e.g. in ~/.zshrc: export PATH="$HOME/.local/bin:$PATH"). It will use ${nodeRuntime.version} from ${nodeRuntime.binPath}.`
      : `Installed to ${installDir}. Ensure it is included in your PATH. It will use ${nodeRuntime.version} from ${nodeRuntime.binPath}.`;

  return {
    ok: true,
    installPath: wrapperPath,
    pathInstruction
  };
}
