// Persistent runner service (Runner Layer).
//
// A host-managed supervisor around the existing one-shot claim-and-launch path.
// The CLI owns install/start/stop/status/uninstall of an OS-level user service
// (macOS launchd LaunchAgent, Linux `systemd --user` unit) whose only job is to
// run `ovld runner supervise` — the long-running loop that delegates
// each poll to the same code used by `ovld runner once`.
//
// This module keeps all pure, testable logic — fallback interval jitter,
// service-file rendering, and local state I/O — separate from the thin process
// exec wiring so the behavior can be unit-tested without touching the host OS.

import { execFile } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { isLoopbackBackendUrl, resolveGlobalDataDir } from './config.js';

const execFileAsync = promisify(execFile);

/**
 * The rendered service definition embeds a user token in its environment, so the
 * file must never be world-readable. Owner read/write only.
 */
function writeServiceFile(filePath: string, contents: string): void {
  writeFileSync(filePath, contents, { mode: 0o600 });
  // `mode` on writeFileSync is ignored when the file already exists, so enforce
  // it explicitly for the overwrite-an-existing-unit case.
  chmodSync(filePath, 0o600);
}

// ---- Constants --------------------------------------------------------------

export const RUNNER_SERVICE_STATE_FILENAME = 'runner-service.json';
/** macOS launchd LaunchAgent label. */
export const LAUNCHD_LABEL = 'io.overlord.runner';
/** Linux systemd --user unit name (without the `.service` suffix). */
export const SYSTEMD_UNIT_NAME = 'overlord-runner';

// ---- Supervisor executable identity ----------------------------------------

/**
 * A small, process-local fingerprint for the executable files that keep a
 * runner supervisor alive. Replacing an application bundle ordinarily changes
 * the inode; an in-place package update is still caught by its modification
 * time. Nothing here is persisted because it describes this process's launch,
 * not service diagnostic state.
 */
export interface RunnerExecutableFileIdentity {
  dev: number;
  ino: number;
  mtimeMs: number;
}

export interface RunnerSupervisorIdentity {
  program: RunnerExecutableFileIdentity | null | undefined;
  entryScript: RunnerExecutableFileIdentity | null | undefined;
}

type StatFile = (filePath: string) => Pick<RunnerExecutableFileIdentity, 'dev' | 'ino' | 'mtimeMs'>;

/**
 * Resolve the script Node/Electron-as-Node was asked to execute. The normal
 * `ovld runner supervise` path always has one; retain `null` for embedders that
 * deliberately start Node without a script.
 */
export function resolveRunnerEntryScript(argv: string[] = process.argv): string | null {
  return argv[1] ? path.resolve(argv[1]) : null;
}

/**
 * Read one file identity without letting a transient inspection failure break a
 * healthy supervisor. `null` specifically means the file is gone; `undefined`
 * is any other stat failure and is deliberately ignored by restart decisions.
 */
export function readRunnerExecutableFileIdentity(
  filePath: string,
  stat: StatFile = statSync
): RunnerExecutableFileIdentity | null | undefined {
  try {
    const metadata = stat(filePath);
    return { dev: metadata.dev, ino: metadata.ino, mtimeMs: metadata.mtimeMs };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined;
  }
}

/** Capture the process program and entry-script fingerprints at one instant. */
export function captureRunnerSupervisorIdentity({
  execPath = process.execPath,
  entryScript = resolveRunnerEntryScript(),
  stat = statSync
}: {
  execPath?: string;
  entryScript?: string | null;
  stat?: StatFile;
} = {}): RunnerSupervisorIdentity {
  return {
    program: readRunnerExecutableFileIdentity(execPath, stat),
    entryScript: entryScript ? readRunnerExecutableFileIdentity(entryScript, stat) : undefined
  };
}

function executableIdentityChanged(
  initial: RunnerExecutableFileIdentity | null | undefined,
  current: RunnerExecutableFileIdentity | null | undefined
): boolean {
  // A missing executable is decisive even when the initial inspection was
  // unavailable: this process cannot safely continue after its launch source is
  // removed. Other stat errors remain intentionally non-fatal.
  if (current === null) return true;
  if (!initial || !current) return false;
  return (
    initial.dev !== current.dev ||
    initial.ino !== current.ino ||
    initial.mtimeMs !== current.mtimeMs
  );
}

/**
 * Whether the supervisor should exit cleanly so its OS service manager can
 * restart it from the installed build. This pure comparison keeps all file I/O
 * and process wiring outside tests.
 */
export function shouldRestartRunnerSupervisor({
  initial,
  current
}: {
  initial: RunnerSupervisorIdentity;
  current: RunnerSupervisorIdentity;
}): boolean {
  return (
    executableIdentityChanged(initial.program, current.program) ||
    executableIdentityChanged(initial.entryScript, current.entryScript)
  );
}

/** Portable fallback cadence for SQLite, which has no queue notification. */
export const FALLBACK_POLL_INTERVAL_MS = 5000;

export type RunnerServiceKind = 'launchd' | 'systemd';

// ---- Local state ------------------------------------------------------------

export interface RunnerServiceState {
  serviceKind: RunnerServiceKind | null;
  serviceIdentifier: string | null;
  execProgram: string | null;
  execArgs: string[];
  backendUrl: string | null;
  installedAt: string | null;
  lastHeartbeatAt: string | null;
  lastClaimedAt: string | null;
  lastLaunchedAt: string | null;
  lastError: string | null;
  currentPollIntervalMs: number | null;
}

export function emptyRunnerServiceState(): RunnerServiceState {
  return {
    serviceKind: null,
    serviceIdentifier: null,
    execProgram: null,
    execArgs: [],
    backendUrl: null,
    installedAt: null,
    lastHeartbeatAt: null,
    lastClaimedAt: null,
    lastLaunchedAt: null,
    lastError: null,
    currentPollIntervalMs: null
  };
}

export function runnerServiceStatePath(dataDir: string = resolveGlobalDataDir()): string {
  return path.join(dataDir, RUNNER_SERVICE_STATE_FILENAME);
}

export function readRunnerServiceState(
  dataDir: string = resolveGlobalDataDir()
): RunnerServiceState {
  const filePath = runnerServiceStatePath(dataDir);
  if (!existsSync(filePath)) return emptyRunnerServiceState();
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<RunnerServiceState>;
    return { ...emptyRunnerServiceState(), ...parsed };
  } catch {
    // A corrupt state file is local diagnostic data only; never fail a poll or a
    // status read because of it — start from a clean slate.
    return emptyRunnerServiceState();
  }
}

export function writeRunnerServiceState(
  state: RunnerServiceState,
  dataDir: string = resolveGlobalDataDir()
): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(runnerServiceStatePath(dataDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** Merge a partial patch into the persisted state and write it back. */
export function patchRunnerServiceState(
  patch: Partial<RunnerServiceState>,
  dataDir: string = resolveGlobalDataDir()
): RunnerServiceState {
  const next = { ...readRunnerServiceState(dataDir), ...patch };
  writeRunnerServiceState(next, dataDir);
  return next;
}

/**
 * Add ~10% jitter so many local runners polling a shared backend do not wake in
 * lockstep. `random` is injectable for deterministic tests.
 */
export function applyPollJitter(intervalMs: number, random: () => number = Math.random): number {
  const spread = intervalMs * 0.1;
  return Math.round(intervalMs + (random() * 2 - 1) * spread);
}

// ---- Service invocation resolution -----------------------------------------

export interface RunnerServiceInvocation {
  program: string;
  args: string[];
  /**
   * True when `program` is the Electron/Overlord app binary and must be run as
   * Node (`ELECTRON_RUN_AS_NODE=1`) instead of booting the GUI. Recording the
   * Overlord binary also makes macOS register the background item, login item,
   * and automation prompt under "Overlord" rather than the plain `node`
   * binary's "Node.js Foundation" signature.
   */
  runAsElectronNode?: boolean;
}

/**
 * If the Overlord desktop app is installed, resolve an invocation that runs the
 * persistent service through the app's own bundled binary and CLI (as Node).
 * macOS attributes a LaunchAgent's background item / automation prompt to the
 * code-signing identity of `ProgramArguments[0]`; using the signed Overlord
 * binary registers the service under "Overlord" instead of "Node.js Foundation".
 * Both the binary and the app-bundled CLI script are used so the runtime and its
 * native modules match the app's Electron ABI. Returns null when the app is not
 * found (e.g. a CLI-only install with no desktop app present).
 */
export function resolveOverlordAppInvocation({
  platform = process.platform,
  homedir = os.homedir(),
  exists = existsSync
}: {
  platform?: NodeJS.Platform;
  homedir?: string;
  exists?: (candidate: string) => boolean;
} = {}): RunnerServiceInvocation | null {
  if (platform !== 'darwin') return null;
  const appDirs = [
    '/Applications/Overlord.app',
    path.join(homedir, 'Applications', 'Overlord.app')
  ];
  for (const appDir of appDirs) {
    const program = path.join(appDir, 'Contents', 'MacOS', 'Overlord');
    const script = path.join(appDir, 'Contents', 'Resources', 'cli', 'bin', 'ovld.mjs');
    if (exists(program) && exists(script)) {
      return { program, args: [script, 'runner', 'supervise'], runAsElectronNode: true };
    }
  }
  return null;
}

/**
 * Resolve how the installed service should invoke `ovld runner supervise`.
 * Prefer an explicit override (`OVLD_RUNNER_EXEC`, space-free path), otherwise
 * re-run the current CLI entrypoint under the same Node runtime. Persistent
 * services start with a sparse environment, so we always record an absolute
 * program path rather than relying on `PATH` resolution of a bare `ovld`.
 *
 * When the installer already runs under Electron-as-Node (the desktop app path),
 * `process.execPath` is the Overlord binary — keep using it. Otherwise, for a
 * plain terminal install, prefer the installed Overlord app binary when present
 * so the service registers under "Overlord" rather than "Node.js Foundation".
 */
export function resolveOvldInvocation(
  argv: string[] = process.argv,
  execPath: string = process.execPath
): RunnerServiceInvocation {
  const override = process.env.OVLD_RUNNER_EXEC?.trim();
  if (override) {
    return { program: override, args: ['runner', 'supervise'] };
  }
  const scriptPath = argv[1] ? path.resolve(argv[1]) : '';
  if (process.env.ELECTRON_RUN_AS_NODE) {
    return scriptPath
      ? { program: execPath, args: [scriptPath, 'runner', 'supervise'], runAsElectronNode: true }
      : { program: execPath, args: ['runner', 'supervise'], runAsElectronNode: true };
  }
  const appInvocation = resolveOverlordAppInvocation();
  if (appInvocation) return appInvocation;
  if (scriptPath) {
    return { program: execPath, args: [scriptPath, 'runner', 'supervise'] };
  }
  return { program: execPath, args: ['runner', 'supervise'] };
}

/**
 * Environment snapshot injected into the service definition. Persistent services
 * do not source interactive shell startup files, so the Overlord home and a
 * minimal PATH must be captured explicitly at install time. Remote backend URLs
 * are also captured because the service cannot infer them locally. A loopback
 * URL is deliberately omitted: Desktop may select a different local port on its
 * next boot, and the supervisor must follow the current `overlord.toml` value.
 */
export function buildRunnerServiceEnv({
  backendUrl,
  overlordHome,
  runAsElectronNode
}: {
  backendUrl: string;
  overlordHome?: string | null;
  runAsElectronNode?: boolean;
}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH?.trim() || '/usr/local/bin:/usr/bin:/bin'
  };
  if (!isLoopbackBackendUrl(backendUrl)) env.OVERLORD_BACKEND_URL = backendUrl;
  const home = overlordHome?.trim() || process.env.OVLD_HOME?.trim();
  if (home) env.OVLD_HOME = path.resolve(home);
  const token = process.env.OVERLORD_USER_TOKEN?.trim() || process.env.OVLD_USER_TOKEN?.trim();
  if (token) env.OVERLORD_USER_TOKEN = token;
  // When the service program is the Overlord/Electron binary — either because the
  // install ran inside the desktop shell (Electron executing this script as Node)
  // or because a terminal install resolved the installed app binary — the unit
  // must carry this flag or launchd/systemd would boot GUI app instances on a
  // KeepAlive loop instead of the supervisor. It also makes macOS register the
  // background item and automation prompt under "Overlord" rather than "Node".
  if (runAsElectronNode || process.env.ELECTRON_RUN_AS_NODE) env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

// ---- Service file rendering (pure) -----------------------------------------

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderLaunchdPlist({
  label,
  invocation,
  env,
  logDir
}: {
  label: string;
  invocation: RunnerServiceInvocation;
  env: Record<string, string>;
  logDir: string;
}): string {
  const programArgs = [invocation.program, ...invocation.args]
    .map(arg => `    <string>${xmlEscape(arg)}</string>`)
    .join('\n');
  const envEntries = Object.entries(env)
    .map(
      ([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logDir, 'runner-service.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logDir, 'runner-service.err.log'))}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

export function renderSystemdUnit({
  invocation,
  env
}: {
  invocation: RunnerServiceInvocation;
  env: Record<string, string>;
}): string {
  // systemd ExecStart requires an absolute program; arguments are space-joined.
  // None of our arguments contain spaces (resolved script path aside, which we
  // quote defensively).
  const quote = (value: string): string => (/\s/.test(value) ? `"${value}"` : value);
  const execStart = [invocation.program, ...invocation.args].map(quote).join(' ');
  const envLines = Object.entries(env)
    .map(([key, value]) => `Environment=${key}=${value}`)
    .join('\n');
  return `[Unit]
Description=Overlord persistent runner supervisor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
${envLines}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

// ---- Service manager abstraction -------------------------------------------

export interface RunnerServiceRunState {
  installed: boolean;
  running: 'running' | 'stopped' | 'unknown';
}

export interface RunnerServiceManager {
  kind: RunnerServiceKind;
  identifier: string;
  unitPath(): string;
  render(opts: { invocation: RunnerServiceInvocation; env: Record<string, string> }): string;
  install(opts: {
    invocation: RunnerServiceInvocation;
    env: Record<string, string>;
    autoStart: boolean;
  }): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  uninstall(): Promise<void>;
  status(): Promise<RunnerServiceRunState>;
}

function launchAgentsDir(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

function systemdUserDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg ? path.resolve(xdg) : path.join(os.homedir(), '.config');
  return path.join(base, 'systemd', 'user');
}

async function runCommand(program: string, args: string[]): Promise<{ stdout: string }> {
  const { stdout } = await execFileAsync(program, args);
  return { stdout: stdout.toString() };
}

/**
 * A single `launchctl` invocation. `tolerateFailure` marks the steps whose
 * failure is an expected state rather than an error — booting out a label that
 * is not loaded, or bootstrapping one that already is.
 */
export interface LaunchctlStep {
  args: string[];
  tolerateFailure: boolean;
}

export type LaunchctlRunner = (args: string[]) => Promise<{ stdout: string }>;

function launchdDomainTarget(uid: string | number): string {
  return `gui/${uid}`;
}

function launchdServiceTarget(uid: string | number): string {
  return `${launchdDomainTarget(uid)}/${LAUNCHD_LABEL}`;
}

/**
 * Commands that take the agent out of launchd entirely. `bootout` removes the
 * registered job definition, which is the part that matters: `kickstart -k`
 * only restarts launchd's already-registered IN-MEMORY definition and never
 * re-reads the plist, so a rewritten plist would otherwise be ignored.
 */
export function planLaunchdUnloadCommands(opts: { uid: string | number }): LaunchctlStep[] {
  return [{ args: ['bootout', launchdServiceTarget(opts.uid)], tolerateFailure: true }];
}

/**
 * Commands that register and start the agent from the plist on disk.
 *
 * `enable` first because the legacy `launchctl unload -w` this code used to
 * issue marks the label disabled persistently, and a disabled label is not
 * started by `bootstrap`. `bootstrap` tolerates failure so a start against an
 * already-loaded label is not an error; the following `kickstart` is strict, so
 * a genuinely broken definition still surfaces (nothing to kick, no service).
 * `kickstart` is deliberately used without `-k` here: it starts the job if it is
 * not running and is a no-op if it is, so `start` never kills a healthy
 * supervisor mid-launch.
 */
export function planLaunchdLoadCommands(opts: {
  uid: string | number;
  plistPath: string;
}): LaunchctlStep[] {
  const service = launchdServiceTarget(opts.uid);
  return [
    { args: ['enable', service], tolerateFailure: true },
    {
      args: ['bootstrap', launchdDomainTarget(opts.uid), opts.plistPath],
      tolerateFailure: true
    },
    { args: ['kickstart', service], tolerateFailure: false }
  ];
}

export class LaunchdManager implements RunnerServiceManager {
  readonly kind = 'launchd' as const;
  readonly identifier = LAUNCHD_LABEL;

  private readonly exec: LaunchctlRunner;

  constructor(exec?: LaunchctlRunner) {
    this.exec = exec ?? (args => runCommand('launchctl', args));
  }

  unitPath(): string {
    return path.join(launchAgentsDir(), `${LAUNCHD_LABEL}.plist`);
  }

  private uid(): string | number {
    return process.getuid?.() ?? '';
  }

  private async runSteps(steps: LaunchctlStep[]): Promise<void> {
    for (const step of steps) {
      try {
        await this.exec(step.args);
      } catch (error) {
        if (!step.tolerateFailure) throw error;
      }
    }
  }

  /** True when launchd still has the label registered, whatever its run state. */
  private async isLoaded(): Promise<boolean> {
    try {
      await this.exec(['list', LAUNCHD_LABEL]);
      return true;
    } catch {
      return false;
    }
  }

  render(opts: { invocation: RunnerServiceInvocation; env: Record<string, string> }): string {
    return renderLaunchdPlist({
      label: LAUNCHD_LABEL,
      invocation: opts.invocation,
      env: opts.env,
      logDir: path.join(resolveGlobalDataDir(), 'logs')
    });
  }

  async install(opts: {
    invocation: RunnerServiceInvocation;
    env: Record<string, string>;
    autoStart: boolean;
  }): Promise<void> {
    mkdirSync(launchAgentsDir(), { recursive: true });
    mkdirSync(path.join(resolveGlobalDataDir(), 'logs'), { recursive: true });
    // Boot the old definition out BEFORE writing, so an install over a loaded
    // label cannot leave launchd running the previous ProgramArguments and
    // EnvironmentVariables — the failure that made a desktop uninstall +
    // reinstall a no-op after an app update.
    await this.runSteps(planLaunchdUnloadCommands({ uid: this.uid() }));
    writeServiceFile(this.unitPath(), this.render(opts));
    if (opts.autoStart) await this.start();
  }

  async start(): Promise<void> {
    await this.runSteps(planLaunchdLoadCommands({ uid: this.uid(), plistPath: this.unitPath() }));
  }

  async stop(): Promise<void> {
    await this.runSteps(planLaunchdUnloadCommands({ uid: this.uid() }));
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async uninstall(): Promise<void> {
    await this.runSteps(planLaunchdUnloadCommands({ uid: this.uid() }));
    // Deleting the plist while the label stays registered is the worst outcome:
    // the old definition keeps running and the only file that could correct it
    // is gone. Keep the plist in that case and say so.
    if (await this.isLoaded()) {
      throw new Error(
        `launchctl still reports ${LAUNCHD_LABEL} as loaded after bootout; left ${this.unitPath()} in place so the service can be repaired with \`ovld runner service restart\`.`
      );
    }
    if (existsSync(this.unitPath())) rmSync(this.unitPath());
  }

  async status(): Promise<RunnerServiceRunState> {
    const installed = existsSync(this.unitPath());
    try {
      const { stdout } = await this.exec(['list']);
      const line = stdout.split('\n').find(row => row.includes(LAUNCHD_LABEL));
      if (!line) return { installed, running: installed ? 'stopped' : 'unknown' };
      // launchctl list columns: PID  Status  Label. A numeric PID => running.
      const pid = line.trim().split(/\s+/)[0];
      return { installed, running: pid && pid !== '-' ? 'running' : 'stopped' };
    } catch {
      return { installed, running: 'unknown' };
    }
  }
}

class SystemdUserManager implements RunnerServiceManager {
  readonly kind = 'systemd' as const;
  readonly identifier = `${SYSTEMD_UNIT_NAME}.service`;

  unitPath(): string {
    return path.join(systemdUserDir(), `${SYSTEMD_UNIT_NAME}.service`);
  }

  render(opts: { invocation: RunnerServiceInvocation; env: Record<string, string> }): string {
    return renderSystemdUnit(opts);
  }

  async install(opts: {
    invocation: RunnerServiceInvocation;
    env: Record<string, string>;
    autoStart: boolean;
  }): Promise<void> {
    mkdirSync(systemdUserDir(), { recursive: true });
    writeServiceFile(this.unitPath(), this.render(opts));
    await runCommand('systemctl', ['--user', 'daemon-reload']);
    await runCommand('systemctl', ['--user', 'enable', this.identifier]);
    if (opts.autoStart) await this.start();
  }

  async start(): Promise<void> {
    await runCommand('systemctl', ['--user', 'start', this.identifier]);
  }

  async stop(): Promise<void> {
    await runCommand('systemctl', ['--user', 'stop', this.identifier]);
  }

  async restart(): Promise<void> {
    await runCommand('systemctl', ['--user', 'restart', this.identifier]);
  }

  async uninstall(): Promise<void> {
    try {
      await this.stop();
      await runCommand('systemctl', ['--user', 'disable', this.identifier]);
    } catch {
      // Unit may not be active/enabled; still remove the file below.
    }
    if (existsSync(this.unitPath())) rmSync(this.unitPath());
    try {
      await runCommand('systemctl', ['--user', 'daemon-reload']);
    } catch {
      // Best effort.
    }
  }

  async status(): Promise<RunnerServiceRunState> {
    const installed = existsSync(this.unitPath());
    try {
      const { stdout } = await runCommand('systemctl', ['--user', 'is-active', this.identifier]);
      return { installed, running: stdout.trim() === 'active' ? 'running' : 'stopped' };
    } catch {
      // `is-active` exits non-zero when inactive/failed.
      return { installed, running: installed ? 'stopped' : 'unknown' };
    }
  }
}

/**
 * Resolve the host service manager for the current platform. Windows is not yet
 * supported (Task Scheduler is a documented follow-up), so it returns null.
 */
export function resolveServiceManager(
  platform: NodeJS.Platform = process.platform
): RunnerServiceManager | null {
  if (platform === 'darwin') return new LaunchdManager();
  if (platform === 'linux') return new SystemdUserManager();
  return null;
}
