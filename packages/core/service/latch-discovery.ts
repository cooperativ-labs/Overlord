/**
 * Latch capability discovery (coo:702).
 *
 * Runs read-only `latch capabilities --json` on the machine where the process
 * will run, never as a side effect of settings render on a different laptop.
 * Callers (runner at launch, settings when co-located) must invoke this on the
 * execution target itself — for an AgentPod-adopted runner that is the pod; for
 * a host runner that is the host.
 *
 * Three distinguishable states: found / not_installed / incompatible. Direct
 * execution stays selectable in every state. Never installs or upgrades Latch.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_LATCH_EXECUTABLE } from './terminal-profile-types.ts';

/** Protocol version Overlord's Latch provider speaks today. */
export const SUPPORTED_LATCH_PROTOCOL_VERSION = 1;

/**
 * Capabilities required before Overlord offers Latch as a launch provider.
 * `openViewer` is deliberately not required: viewer open is best-effort and
 * "don't open a window" is a legitimate mode.
 */
export const REQUIRED_LATCH_CAPABILITIES = ['create'] as const;

export type RequiredLatchCapability = (typeof REQUIRED_LATCH_CAPABILITIES)[number];

/**
 * Standalone install command shown when Latch is missing. Overlord never runs
 * this — settings and diagnostics present it for the user to copy.
 */
export const LATCH_STANDALONE_INSTALL_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/jchaselubitz/Latch/main/scripts/install-cli.sh | bash';

export const LATCH_DISCOVERY_CACHE_FILENAME = 'latch-discovery.json';

/**
 * Default on-disk cache path, resolved the same way the CLI resolves its global
 * data dir (`OVLD_HOME`, else `~/.ovld`). Sharing the file means a settings
 * probe and a launch probe on one device reuse each other's revalidation.
 */
export function defaultLatchDiscoveryCachePath(): string {
  const home = process.env.OVLD_HOME?.trim() || path.join(os.homedir(), '.ovld');
  return path.join(home, LATCH_DISCOVERY_CACHE_FILENAME);
}

export type LatchCapabilityFlags = {
  create: boolean;
  openViewer: boolean;
  localAttach: boolean;
  cloudAttach: boolean;
  selfUpdate: boolean;
  extensions: string[];
};

/** Wire shape of `latch capabilities --json`. */
export type LatchCapabilitiesReport = {
  protocolVersion: number;
  productVersion: string;
  capabilities: LatchCapabilityFlags;
};

export type LatchDiscoveryState = 'found' | 'not_installed' | 'incompatible';

type LatchDiscoveryBase = {
  /** The executable name or path that was probed. */
  executable: string;
  /** ISO timestamp of the probe (or the cache hit that reused it). */
  checkedAt: string;
  /**
   * Whether Latch may be offered as an execution provider. Always false for
   * not_installed / incompatible; true only for found. Direct remains selectable
   * regardless.
   */
  latchSelectable: boolean;
  /** Direct execution is always selectable — surfaced explicitly for callers. */
  directSelectable: true;
};

export type LatchDiscoveryFound = LatchDiscoveryBase & {
  state: 'found';
  resolvedPath: string;
  protocolVersion: number;
  productVersion: string;
  capabilities: LatchCapabilityFlags;
};

export type LatchDiscoveryNotInstalled = LatchDiscoveryBase & {
  state: 'not_installed';
  /** Standalone CLI install command; never auto-run. */
  installCommand: string;
};

export type LatchDiscoveryIncompatible = LatchDiscoveryBase & {
  state: 'incompatible';
  resolvedPath: string | null;
  protocolVersion: number | null;
  productVersion: string | null;
  /** Stable id of what is missing, e.g. `create` or `protocolVersion`. */
  missingCapability: string;
  detail: string;
};

export type LatchDiscoveryResult =
  | LatchDiscoveryFound
  | LatchDiscoveryNotInstalled
  | LatchDiscoveryIncompatible;

export type LatchDiscoveryCacheEntry = {
  result: LatchDiscoveryResult;
  /** mtimeMs of the resolved binary when known; null for not_installed. */
  binaryMtimeMs: number | null;
  cachedAt: string;
};

export type LatchDiscoveryCacheFile = {
  version: 1;
  entries: Record<string, LatchDiscoveryCacheEntry>;
};

/** Injectable command runner for tests. */
export type LatchCommandRunner = (args: { executable: string; argv: string[] }) => {
  status: number | null;
  stdout: string;
  stderr: string;
};

/** Injectable path resolver for tests. */
export type LatchPathResolver = (executable: string) => string | null;

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Parse `latch capabilities --json` stdout. Returns null when the document is
 * not a recognizable capabilities report (wrong shape / empty / non-JSON).
 */
export function parseLatchCapabilitiesReport(raw: string): LatchCapabilitiesReport | null {
  const text = raw.trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const cast = parsed as {
    protocolVersion?: unknown;
    productVersion?: unknown;
    capabilities?: unknown;
  };
  const protocolVersion =
    typeof cast.protocolVersion === 'number' && Number.isFinite(cast.protocolVersion)
      ? Math.trunc(cast.protocolVersion)
      : null;
  const productVersion = trimmed(cast.productVersion);
  if (protocolVersion === null || !productVersion) return null;
  if (
    !cast.capabilities ||
    typeof cast.capabilities !== 'object' ||
    Array.isArray(cast.capabilities)
  ) {
    return null;
  }
  const caps = cast.capabilities as Record<string, unknown>;
  return {
    protocolVersion,
    productVersion,
    capabilities: {
      create: asBoolean(caps.create),
      openViewer: asBoolean(caps.openViewer),
      localAttach: asBoolean(caps.localAttach),
      cloudAttach: asBoolean(caps.cloudAttach),
      selfUpdate: asBoolean(caps.selfUpdate),
      extensions: asStringArray(caps.extensions)
    }
  };
}

/**
 * Evaluate a parsed report against Overlord's supported protocol and required
 * capabilities. Names the first missing requirement when incompatible.
 */
export function evaluateLatchCapabilities({
  report,
  executable,
  resolvedPath,
  checkedAt = new Date().toISOString()
}: {
  report: LatchCapabilitiesReport;
  executable: string;
  resolvedPath: string;
  checkedAt?: string;
}): LatchDiscoveryFound | LatchDiscoveryIncompatible {
  if (report.protocolVersion !== SUPPORTED_LATCH_PROTOCOL_VERSION) {
    return {
      state: 'incompatible',
      executable,
      resolvedPath,
      protocolVersion: report.protocolVersion,
      productVersion: report.productVersion,
      missingCapability: 'protocolVersion',
      detail: `Latch protocolVersion ${report.protocolVersion} is not supported (need ${SUPPORTED_LATCH_PROTOCOL_VERSION}).`,
      checkedAt,
      latchSelectable: false,
      directSelectable: true
    };
  }

  for (const required of REQUIRED_LATCH_CAPABILITIES) {
    if (!report.capabilities[required]) {
      return {
        state: 'incompatible',
        executable,
        resolvedPath,
        protocolVersion: report.protocolVersion,
        productVersion: report.productVersion,
        missingCapability: required,
        detail: `Latch is missing required capability \`${required}\`.`,
        checkedAt,
        latchSelectable: false,
        directSelectable: true
      };
    }
  }

  return {
    state: 'found',
    executable,
    resolvedPath,
    protocolVersion: report.protocolVersion,
    productVersion: report.productVersion,
    capabilities: report.capabilities,
    checkedAt,
    latchSelectable: true,
    directSelectable: true
  };
}

function resolveLatchExecutableOnPath(executable: string): string | null {
  try {
    const found = execFileSync('which', [executable], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return found || null;
  } catch {
    return null;
  }
}

/**
 * Resolve Latch's documented installation location when a GUI app or managed
 * service did not inherit the interactive shell's PATH. This does not source a
 * shell profile, avoiding arbitrary shell-startup side effects during a
 * read-only settings probe.
 */
export function resolveLatchExecutablePathFromEnvironment({
  executable,
  homeDirectory = os.homedir(),
  platform = process.platform,
  resolveOnPath = resolveLatchExecutableOnPath,
  fileExists = existsSync
}: {
  executable: string;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  resolveOnPath?: (executable: string) => string | null;
  fileExists?: (filePath: string) => boolean;
}): string | null {
  const name = trimmed(executable) ?? DEFAULT_LATCH_EXECUTABLE;
  if (path.isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    return fileExists(name) ? path.resolve(name) : null;
  }

  const resolvedOnPath = resolveOnPath(name);
  if (resolvedOnPath) return resolvedOnPath;

  // `install-cli.sh` installs Latch here. Homebrew locations cover existing
  // macOS installations whose PATH was inherited from Finder or launchd.
  const fallbacks = [
    path.join(homeDirectory, '.local', 'bin', name),
    ...(platform === 'darwin' ? [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`] : [])
  ];
  const fallback = fallbacks.find(fileExists);
  return fallback ? path.resolve(fallback) : null;
}

/** Default resolver for a Latch executable available to the current process. */
export function resolveLatchExecutablePath(executable: string): string | null {
  return resolveLatchExecutablePathFromEnvironment({ executable });
}

const defaultCommandRunner: LatchCommandRunner = ({ executable, argv }) => {
  try {
    const stdout = execFileSync(executable, argv, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000
    });
    return { status: 0, stdout: String(stdout), stderr: '' };
  } catch (error) {
    const err = error as {
      status?: number | null;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: string;
    };
    if (err.code === 'ENOENT') {
      return { status: null, stdout: '', stderr: 'ENOENT' };
    }
    return {
      status: typeof err.status === 'number' ? err.status : 1,
      stdout: err.stdout ? String(err.stdout) : '',
      stderr: err.stderr ? String(err.stderr) : String(error)
    };
  }
};

function notInstalledResult({
  executable,
  checkedAt
}: {
  executable: string;
  checkedAt: string;
}): LatchDiscoveryNotInstalled {
  return {
    state: 'not_installed',
    executable,
    installCommand: LATCH_STANDALONE_INSTALL_COMMAND,
    checkedAt,
    latchSelectable: false,
    directSelectable: true
  };
}

/**
 * Probe Latch on **this** machine. Call only from a process that already runs
 * on the execution target (runner, co-located CLI, in-process local-target).
 */
export function probeLatchCapabilities({
  executable = DEFAULT_LATCH_EXECUTABLE,
  resolvePath = resolveLatchExecutablePath,
  runCommand = defaultCommandRunner,
  now = () => new Date().toISOString()
}: {
  executable?: string;
  resolvePath?: LatchPathResolver;
  runCommand?: LatchCommandRunner;
  now?: () => string;
} = {}): LatchDiscoveryResult {
  const exe = trimmed(executable) ?? DEFAULT_LATCH_EXECUTABLE;
  const checkedAt = now();
  const resolvedPath = resolvePath(exe);
  if (!resolvedPath) {
    return notInstalledResult({ executable: exe, checkedAt });
  }

  const ran = runCommand({ executable: resolvedPath, argv: ['capabilities', '--json'] });
  if (ran.status === null && ran.stderr === 'ENOENT') {
    return notInstalledResult({ executable: exe, checkedAt });
  }

  const report = parseLatchCapabilitiesReport(ran.stdout);
  if (!report) {
    return {
      state: 'incompatible',
      executable: exe,
      resolvedPath,
      protocolVersion: null,
      productVersion: null,
      missingCapability: 'capabilities',
      detail:
        ran.status === 0
          ? 'Latch capabilities output was not valid JSON in the expected shape.'
          : `Latch capabilities failed (exit ${ran.status ?? 'null'}).`,
      checkedAt,
      latchSelectable: false,
      directSelectable: true
    };
  }

  return evaluateLatchCapabilities({ report, executable: exe, resolvedPath, checkedAt });
}

export function latchDiscoveryCacheKey({
  executionTargetId,
  executable
}: {
  executionTargetId: string;
  executable: string;
}): string {
  const exe = trimmed(executable) ?? DEFAULT_LATCH_EXECUTABLE;
  return `${executionTargetId}::${exe}`;
}

function readBinaryMtimeMs(resolvedPath: string | null | undefined): number | null {
  if (!resolvedPath) return null;
  try {
    return statSync(resolvedPath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Cheap revalidation: reuse a cache entry when the binary still exists at the
 * same path with the same mtime (found/incompatible), or when `which` still
 * finds nothing (not_installed). Otherwise re-probe.
 */
export function isLatchDiscoveryCacheFresh({
  entry,
  resolvePath = resolveLatchExecutablePath
}: {
  entry: LatchDiscoveryCacheEntry;
  resolvePath?: LatchPathResolver;
}): boolean {
  const { result } = entry;
  if (result.state === 'not_installed') {
    return resolvePath(result.executable) === null;
  }
  const pathStill = result.resolvedPath;
  if (!pathStill || !existsSync(pathStill)) return false;
  const mtime = readBinaryMtimeMs(pathStill);
  if (mtime === null || entry.binaryMtimeMs === null) return false;
  return mtime === entry.binaryMtimeMs;
}

export function readLatchDiscoveryCacheFile(filePath: string): LatchDiscoveryCacheFile {
  if (!existsSync(filePath)) return { version: 1, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<LatchDiscoveryCacheFile>;
    if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
      return { version: 1, entries: {} };
    }
    return { version: 1, entries: parsed.entries };
  } catch {
    return { version: 1, entries: {} };
  }
}

export function writeLatchDiscoveryCacheFile({
  filePath,
  cache
}: {
  filePath: string;
  cache: LatchDiscoveryCacheFile;
}): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Discover Latch for one execution target, using a per-target on-disk cache with
 * cheap revalidation. Always runs on the calling machine — the caller must be
 * the execution target.
 */
export function discoverLatchForExecutionTarget({
  executionTargetId,
  executable = DEFAULT_LATCH_EXECUTABLE,
  cacheFilePath,
  force = false,
  resolvePath = resolveLatchExecutablePath,
  runCommand = defaultCommandRunner,
  now = () => new Date().toISOString()
}: {
  executionTargetId: string;
  executable?: string;
  cacheFilePath: string;
  force?: boolean;
  resolvePath?: LatchPathResolver;
  runCommand?: LatchCommandRunner;
  now?: () => string;
}): LatchDiscoveryResult {
  const exe = trimmed(executable) ?? DEFAULT_LATCH_EXECUTABLE;
  const key = latchDiscoveryCacheKey({ executionTargetId, executable: exe });
  const cache = readLatchDiscoveryCacheFile(cacheFilePath);
  const existing = cache.entries[key];

  if (!force && existing && isLatchDiscoveryCacheFresh({ entry: existing, resolvePath })) {
    return { ...existing.result, checkedAt: existing.result.checkedAt, directSelectable: true };
  }

  const result = probeLatchCapabilities({ executable: exe, resolvePath, runCommand, now });
  const binaryMtimeMs =
    result.state === 'not_installed' ? null : readBinaryMtimeMs(result.resolvedPath);
  cache.entries[key] = {
    result,
    binaryMtimeMs,
    cachedAt: result.checkedAt
  };
  writeLatchDiscoveryCacheFile({ filePath: cacheFilePath, cache });
  return result;
}
