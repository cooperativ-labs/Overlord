import {
  type AgentLaunchFlagDto,
  missionDisplayIdFromObjectiveRef,
  normalizeAgentLaunchFlags,
  parseAgentLaunchFlagText,
  parseObjectiveRef
} from '@overlord/contract';
import {
  readProjectJsonLinks,
  writeProjectJson
} from '@overlord/core/service/local-target/project-metadata';
import {
  executeLocalTargetMutation,
  parseMutationFromMetadata
} from '@overlord/core/service/local-target-mutation-runner';
import { launchSessionSnapshotFromMetadata } from '@overlord/core/service/terminal-profile-types';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { readBoundedStdin } from './agent-session/event.js';
import { clearActiveMissionPointer, writeActiveMissionPointer } from './active-mission.js';
import {
  finalizeActiveSession,
  readActiveSessions,
  readObjectiveSessions,
  writeActiveSession
} from './active-objective-sessions.js';
import {
  flagBoolean,
  flagOptionalBoolean,
  flagValue,
  parseArgs,
  rejectOversizedInlineJson
} from './args.js';
import { type BranchAutomationPayload, prepareMissionBranch } from './branch-preparation.js';
import { captureChangeFromPayload } from './capture-change.js';
import {
  appendChangeEvidence,
  type LedgerEvidence,
  markChangeEvidenceSynced,
  readChangeLedgerHealth,
  readUnsyncedChangeEvidence
} from './change-ledger.js';
import { isLoopbackBackendUrl, loadConfig, resolveBackendUrl } from './config.js';
import { clientDeviceIdentity } from './device-identity.js';
import {
  discoverProjectOnClient,
  listAccessibleProjects,
  resolvePreferredExecutionTargetId,
  resolveProjectByIdOrName
} from './discover-project-local.js';
import {
  CliError,
  formatExecutionRequestAlreadyLinkedDiagnostic,
  isExecutionRequestAlreadyLinkedError,
  isUnlinkableExecutionRequestError
} from './errors.js';
import { launchAgent } from './launch.js';
import { recoverLaunchBootstrapFromProjectTmp } from './launch-bootstrap.js';
import { fetchLaunchSettings } from './launch-settings.js';
import { resolveNativeSessionId } from './native-session.js';
import { runOrgSetupCommand } from './org-setup.js';
import { printJson, printKeyValue } from './output.js';
import { pruneStaleProjectTmp } from './project-tmp.js';
import { printProtocolHelp } from './protocol-help.js';
import { redactSecrets } from './redact-secrets.js';
import { reportRunnerResourceObservations } from './resource-observations.js';
import { runnerRegistrationPayload } from './runner-identity.js';
import {
  applyPollJitter,
  buildRunnerServiceEnv,
  captureRunnerSupervisorIdentity,
  FALLBACK_POLL_INTERVAL_MS,
  inspectInstalledLaunchdPlist,
  patchRunnerServiceState,
  readRunnerServiceState,
  resolveOvldInvocation,
  resolveServiceManager,
  runnerServiceReinstallHint,
  shouldRestartRunnerSupervisor,
  writeRunnerServiceState
} from './runner-service.js';
import type { CliRuntime } from './runtime.js';
import { promptForProject } from './select-prompt.js';
import {
  clearCachedSessionKey,
  readCachedSessionKey,
  writeCachedSessionKey
} from './session-key.js';
import type { TerminalLaunchSettings } from './terminal-launcher.js';
import { fetchTerminalProfile, terminalProfileToLaunchSettings } from './terminal-profile.js';

/**
 * Normalize an `--access` flag into a `{ accessMode }` request fragment (coo:368).
 * Accepts `read` / `ro` and `read_write` / `read-write` / `rw`; anything else
 * (including absent) omits the field so the backend applies its default (primary
 * → read_write, non-primary → read).
 */
function resourceAccessModeBody(value: string | true | undefined): {
  accessMode?: 'read' | 'read_write';
} {
  if (typeof value !== 'string') return {};
  const normalized = value.trim().toLowerCase();
  if (normalized === 'read' || normalized === 'ro') return { accessMode: 'read' };
  if (normalized === 'read_write' || normalized === 'read-write' || normalized === 'rw') {
    return { accessMode: 'read_write' };
  }
  throw new CliError({
    message: `Invalid --access "${value}". Use "read" or "read_write".`
  });
}

function writeProjectJsonFromResource({
  directory,
  projectId,
  projectName,
  resource
}: {
  directory: string;
  projectId: string;
  projectName?: string | null;
  resource: unknown;
}): void {
  const record = asRecord(resource);
  if (typeof record.id !== 'string') return;
  // coo:368: `read` (reference) resources are never linked into
  // `.overlord/project.json` — only read & write resources are.
  if (record.accessMode === 'read') return;
  writeProjectJson({
    directoryPath: directory,
    projectId,
    projectName,
    resourceId: record.id,
    resourceKey: typeof record.resourceKey === 'string' ? record.resourceKey : undefined,
    executionTargetId:
      typeof record.executionTargetId === 'string' ? record.executionTargetId : undefined,
    isPrimary: record.isPrimary !== false
  });
}

type JsonRecord = Record<string, unknown>;

type ChangeEvidenceIdentity = Pick<LedgerEvidence, 'idempotencyKey' | 'filePath'>;

const SYNC_CHANGE_EVIDENCE_KEYS = new Set([
  'filePath',
  'idempotencyKey',
  'source',
  'quality',
  'overlap',
  'toolWindowId',
  'observedAt',
  'hookHealth'
]);

function changeEvidenceIdentityKey(identity: ChangeEvidenceIdentity): string {
  return JSON.stringify([identity.idempotencyKey, identity.filePath]);
}

function canonicalChangeEvidenceTuple(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as JsonRecord;
  if (Object.keys(record).some(key => !SYNC_CHANGE_EVIDENCE_KEYS.has(key))) return null;
  if (
    typeof record.idempotencyKey !== 'string' ||
    typeof record.filePath !== 'string' ||
    (record.source !== 'declared_edit' && record.source !== 'window_observed') ||
    (record.quality !== 'direct' && record.quality !== 'window') ||
    typeof record.overlap !== 'boolean' ||
    typeof record.observedAt !== 'string' ||
    (record.toolWindowId !== undefined && typeof record.toolWindowId !== 'string') ||
    (record.hookHealth !== undefined && typeof record.hookHealth !== 'string')
  ) {
    return null;
  }
  return JSON.stringify([
    record.idempotencyKey,
    record.filePath,
    record.source,
    record.quality,
    record.overlap,
    record.toolWindowId ?? null,
    record.observedAt,
    record.hookHealth ?? null
  ]);
}

/**
 * Accept only caller-supplied rows that exactly reproduce a current local
 * ledger tuple. A reused key with a different path or metadata must never mark
 * the real local row synchronized merely because the backend accepted it.
 */
function changeBatchEvidenceIdentities(
  raw: string | undefined,
  unsynced: LedgerEvidence[]
): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const localByTuple = new Map(
      unsynced.flatMap(entry => {
        const tuple = canonicalChangeEvidenceTuple(entry);
        return tuple ? [[tuple, entry] as const] : [];
      })
    );
    return new Set(
      parsed.flatMap(item => {
        const tuple = canonicalChangeEvidenceTuple(item);
        const local = tuple ? localByTuple.get(tuple) : undefined;
        return local ? [changeEvidenceIdentityKey(local)] : [];
      })
    );
  } catch {
    return new Set();
  }
}

/**
 * Best-effort drain for normal lifecycle commands. Evidence is synchronized in
 * bounded batches until the ledger is empty or the backend makes no progress.
 * A failed drain is advisory and must not change the lifecycle operation.
 */
async function syncObjectiveLedger({
  runtime,
  workingDirectory,
  missionId,
  sessionKey,
  active
}: {
  runtime: CliRuntime;
  workingDirectory: string;
  missionId: string;
  sessionKey: string;
  active: { missionId: string; objectiveId: string; sessionKey: string };
}): Promise<{ synced: number; warning?: string }> {
  let synced = 0;
  while (true) {
    const changes = readUnsyncedChangeEvidence({
      workingDirectory,
      objectiveId: active.objectiveId,
      sessionKey
    }).slice(0, 25);
    if (changes.length === 0) return { synced };

    try {
      const result = await runtime.backend.post<unknown>({
        path: '/api/protocol/sync-changes',
        body: {
          fileInputs: {},
          args: [],
          positional: [],
          externalSessionId: null,
          flags: {
            '--session-key': sessionKey,
            '--mission-id': missionId,
            '--changes-json': JSON.stringify(changes)
          }
        }
      });
      const outcomes = asRecord(result).outcomes;
      const batch = new Map(
        changes.map(change => [changeEvidenceIdentityKey(change), change] as const)
      );
      const accepted = new Map<string, ChangeEvidenceIdentity>(
        Array.isArray(outcomes)
          ? outcomes.flatMap(outcome => {
              const record = asRecord(outcome);
              if (
                (record.status !== 'accepted' && record.status !== 'ignored') ||
                typeof record.idempotencyKey !== 'string' ||
                typeof record.filePath !== 'string'
              ) {
                return [];
              }
              const identity = {
                idempotencyKey: record.idempotencyKey,
                filePath: record.filePath
              };
              const key = changeEvidenceIdentityKey(identity);
              return batch.has(key) ? [[key, identity] as const] : [];
            })
          : []
      );
      if (accepted.size === 0) {
        return { synced, warning: 'change ledger sync made no progress' };
      }
      markChangeEvidenceSynced({
        workingDirectory,
        objectiveId: active.objectiveId,
        sessionKey,
        evidence: [...accepted.values()]
      });
      const remainingBatch = new Set(
        readUnsyncedChangeEvidence({
          workingDirectory,
          objectiveId: active.objectiveId,
          sessionKey
        })
          .map(changeEvidenceIdentityKey)
          .filter(key => batch.has(key))
      );
      const progress = changes.filter(
        change => !remainingBatch.has(changeEvidenceIdentityKey(change))
      ).length;
      if (progress === 0) {
        return { synced, warning: 'change ledger sync made no progress' };
      }
      synced += progress;
    } catch {
      return { synced, warning: 'change ledger sync unavailable' };
    }
  }
}

type LaunchSettingsShape = {
  worktreeBranchAutomationEnabled?: unknown;
};

function repeatedLaunchFlags(args: string[], name: string): AgentLaunchFlagDto[] {
  const flags: AgentLaunchFlagDto[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (value !== undefined) {
      const parsed = parseAgentLaunchFlagText(value);
      if (parsed) flags.push(parsed);
      index += 1;
    }
  }
  return flags;
}

/**
 * The stored terminal profile for this device, as launch settings.
 *
 * A read failure is reported, never swallowed: falling back to
 * `terminalLauncher: null` makes the agent run **inline** in the runner's own
 * process, which under `ovld runner service` (no TTY) is exactly the
 * "Launch command exited with status 1" failure, and under a foreground
 * `ovld runner start` blocks the poll loop behind the agent. The caller passes
 * the workspace it already knows (the claimed request's, or the mission's) so
 * the workspace-scoped launch-settings route is used — see `launch-settings.ts`.
 */
async function resolveTerminalLaunchSettings({
  runtime,
  flags,
  workspaceId
}: {
  runtime: CliRuntime;
  flags: Map<string, string | true>;
  workspaceId?: string | null;
}): Promise<TerminalLaunchSettings> {
  if (flagBoolean(flags, '--no-terminal')) {
    return { terminalLauncher: null };
  }

  const override = flagValue(flags, '--terminal');
  try {
    const profile = await fetchTerminalProfile({ backend: runtime.backend, workspaceId });
    if (!override) return terminalProfileToLaunchSettings(profile);
    return {
      terminalLauncher: override,
      terminalLaunchPlacement: profile.placement,
      terminalLaunchChord: profile.chord,
      terminalLaunchBackground: profile.background ?? false
    };
  } catch (error) {
    console.error(
      `[overlord] Could not read your terminal profile (${
        error instanceof Error ? error.message : String(error)
      }). ${
        override
          ? `Launching with --terminal ${override} and default placement.`
          : 'The agent will run inline in this process instead of a new terminal window/tab.'
      }`
    );
    return override ? { terminalLauncher: override } : { terminalLauncher: null };
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? (value as JsonRecord) : {};
}

/** Coerce an unknown API/claim value to a clean list of pre-launch command strings. */
function parsePreLaunchCommandsValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Coerce an unknown API/claim value to a clean name→value launch env-var map. */
function parseLaunchEnvVarsValue(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const vars: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key.trim() && typeof raw === 'string') vars[key] = raw;
  }
  return vars;
}

/**
 * Whether the acting user's worktree/branch automation default is on. It is a
 * user preference (identical in every workspace), so no workspace is passed.
 * Read failures are reported rather than silently disabling automation, which
 * previously made a runner prepare no branch at all and launch straight into
 * the main checkout.
 */
async function readWorktreeBranchAutomationEnabled(runtime: CliRuntime): Promise<boolean> {
  try {
    const settings = await fetchLaunchSettings<LaunchSettingsShape>({
      backend: runtime.backend
    });
    return settings.worktreeBranchAutomationEnabled === true;
  } catch (error) {
    console.error(
      `[overlord] Could not read launch settings (${
        error instanceof Error ? error.message : String(error)
      }); continuing with worktree branch automation disabled.`
    );
    return false;
  }
}

async function recordBranchPrepared({
  runtime,
  missionId,
  requestId,
  branchAutomation
}: {
  runtime: CliRuntime;
  missionId: string;
  requestId?: string | null;
  branchAutomation: BranchAutomationPayload | null;
}): Promise<void> {
  if (!branchAutomation) return;
  await runtime.backend.post({
    path: `/api/missions/${encodeURIComponent(missionId)}/branch-prepared`,
    body: { requestId: requestId ?? null, branchAutomation }
  });
}

export function firstObjectiveId(mission: unknown): string | undefined {
  const objectives = asRecord(mission).objectives;
  if (!Array.isArray(objectives)) return undefined;
  const first = objectives[0];
  const id = asRecord(first).id;
  return typeof id === 'string' ? id : undefined;
}

/** Match server `resolveActiveObjective` for local spawn / mission-launch. */
export function resolveActiveObjectiveId(mission: unknown): string | undefined {
  const objectives = asRecord(mission).objectives;
  if (!Array.isArray(objectives)) return undefined;
  const states = ['executing', 'launching', 'pending_delivery', 'draft'];
  for (const state of states) {
    const match = objectives.find(objective => asRecord(objective).state === state);
    const id = asRecord(match).id;
    if (typeof id === 'string') return id;
  }
  const next = objectives.find(objective => asRecord(objective).state !== 'complete');
  const id = asRecord(next).id;
  return typeof id === 'string' ? id : undefined;
}

/** Objectives the queue will accept (`launchObjective` LAUNCHABLE_STATES). */
export function queueableObjectiveId(mission: unknown): string | undefined {
  const objectives = asRecord(mission).objectives;
  if (!Array.isArray(objectives)) return undefined;
  const launchableStates = ['submitted', 'launching', 'draft'];
  for (const state of launchableStates) {
    const match = objectives.find(objective => asRecord(objective).state === state);
    const id = asRecord(match).id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

/**
 * Find an objective on a fetched mission payload by any of the references a
 * caller may hold: UUID, full display id (`coo:756.k7xm`), or the bare display
 * key. Matching only the UUID would silently miss a `--objective-id` that used
 * the public form, which is the form every prompt and launch command prints.
 */
function findObjectiveByRef(
  mission: unknown,
  objectiveRef: string
): Record<string, unknown> | undefined {
  const objectives = asRecord(mission).objectives;
  if (!Array.isArray(objectives)) return undefined;
  const parsed = parseObjectiveRef(objectiveRef);
  const wanted = objectiveRef.trim().toLowerCase();
  return objectives
    .map(objective => asRecord(objective))
    .find(objective => {
      const id = typeof objective.id === 'string' ? objective.id.toLowerCase() : null;
      const displayId =
        typeof objective.displayId === 'string' ? objective.displayId.toLowerCase() : null;
      const displayKey =
        typeof objective.displayKey === 'string' ? objective.displayKey.toLowerCase() : null;
      if (id === wanted || displayId === wanted) return true;
      if (parsed.kind === 'display_id' && displayKey === parsed.displayKey) return true;
      if (parsed.kind === 'display_key' && displayKey === parsed.displayKey) return true;
      return false;
    });
}

/** The objective UUID for any reference form, falling back to the reference itself. */
function objectiveIdForRef(mission: unknown, objectiveRef: string): string {
  const id = asRecord(findObjectiveByRef(mission, objectiveRef)).id;
  return typeof id === 'string' && id.trim() ? id : objectiveRef;
}

/** The agent already assigned to an objective on a fetched mission payload, if any. */
function objectiveAssignedAgent(mission: unknown, objectiveRef: string): string | undefined {
  const agent = asRecord(findObjectiveByRef(mission, objectiveRef)).assignedAgent;
  return typeof agent === 'string' && agent.trim() ? agent.trim() : undefined;
}

function missionDisplayId(mission: unknown): string {
  const record = asRecord(mission);
  return typeof record.displayId === 'string'
    ? record.displayId
    : typeof record.id === 'string'
      ? record.id
      : 'unknown';
}

const PROTOCOL_FILE_FLAGS = [
  '--summary-file',
  '--question-file',
  '--payload-file',
  '--artifacts-file',
  '--change-rationales-file',
  '--objectives-file',
  '--changes-file',
  '--changed-files-file',
  '--value-file',
  '--content-text-file',
  '--prompt-file',
  '--ordered-entries-file',
  '--ordered-queues-file',
  '--ordered-objective-ids-file'
] as const;

/** Protocol subcommands that require a session key the cache can auto-inject. */
const SESSION_KEY_SUBCOMMANDS = new Set([
  'add-artifact',
  'update',
  'heartbeat',
  'ask',
  'deliver',
  'hook-event',
  'sync-changes'
]);

/**
 * Subcommands whose `--objective-id` may be auto-filled from the launch
 * environment (`OVERLORD_OBJECTIVE_ID`) or the recovered launch bootstrap.
 *
 * These are the commands that operate on the objective the session is already
 * running, so inheriting it is what the caller meant. Deliberately excluded:
 * `update-objective` (the id names the row being mutated, so guessing it would
 * silently edit the wrong objective), `discuss-objective` (it wants a *draft*,
 * never the executing objective the env points at), and the mission-creation
 * commands, where an objective reference has no meaning.
 */
const OBJECTIVE_SCOPED_SUBCOMMANDS = new Set([
  'add-artifact',
  'ask',
  'attachment-download-url',
  'attachment-list',
  'changes',
  'connect',
  'deliver',
  'heartbeat',
  'hook-event',
  'load-context',
  'read-context',
  'capture-change',
  'resume-follow-up',
  'sync-changes',
  'attach',
  'update',
  'update-artifact',
  'write-context'
]);

const RETIRED_CHANGE_TRACKING_FLAGS: Record<string, readonly string[]> = {
  update: ['--track-changed-files', '--changed-files-json', '--changed-files-file'],
  deliver: [
    '--changed-files-json',
    '--changed-files-file',
    '--observed-dirty-paths-json',
    '--observed-dirty-paths-file',
    '--no-file-changes',
    '--skip-rationale-for-json',
    '--skip-rationale-for-file'
  ]
};

const MAX_CHANGES_HEALTH_ENTRIES = 128;
const MAX_DECLARED_OUTPUT_PATHS = 512;

/**
 * `--paths` is deliberately narrow: a single batched declaration for outputs
 * the agent knows a generator or script produced.  It is not a VCS
 * reconciliation path, and it is resolved locally before the normal ledger
 * drain so no raw list crosses the lifecycle request.
 */
function appendDeclaredOutputPaths({
  flags,
  active,
  workingDirectory
}: {
  flags: Record<string, string | true>;
  active: { objectiveId: string; sessionKey: string } | undefined;
  workingDirectory: string;
}): void {
  const value = flags['--paths'];
  if (value === undefined) return;
  delete flags['--paths'];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CliError({ message: '--paths requires a comma-separated list of output paths.' });
  }
  if (!active) {
    throw new CliError({
      message: '--paths requires the attached objective session in this working directory.'
    });
  }
  const paths = value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
  if (paths.length === 0) {
    throw new CliError({ message: '--paths requires at least one output path.' });
  }
  appendChangeEvidence({
    workingDirectory,
    objectiveId: active.objectiveId,
    sessionKey: active.sessionKey,
    filePaths: paths.slice(0, MAX_DECLARED_OUTPUT_PATHS),
    source: 'declared_edit',
    quality: 'direct',
    overlap: false,
    hookHealth: 'agent_declared_generator_output'
  });
}

/**
 * Resolve each `--*-file` flag independently into its canonical `fileInputs`
 * entry.
 * At most one flag may use literal `-` (true stdin); real file paths are unlimited.
 */
export async function resolveProtocolFileInputs({
  flags,
  stdin
}: {
  flags: Map<string, string | true>;
  stdin?: string;
}): Promise<{ fileInputs: Record<string, string> }> {
  const stdinFlags = PROTOCOL_FILE_FLAGS.filter(name => flagValue(flags, name) === '-');
  if (stdinFlags.length > 1) {
    throw new CliError({
      message:
        `Only one --*-file flag may read from stdin ('-') at a time, but received: ` +
        `${stdinFlags.join(', ')}. Pipe a single payload on stdin and pass the others ` +
        `as inline values or real file paths.`
    });
  }

  let stdinContent: string | undefined;
  const readStdinOnce = (): string => {
    if (stdinContent !== undefined) return stdinContent;
    if (stdin !== undefined) {
      stdinContent = stdin;
    } else if (process.stdin.isTTY) {
      stdinContent = '';
    } else {
      stdinContent = readFileSync(0, 'utf8');
    }
    return stdinContent;
  };

  const fileInputs: Record<string, string> = {};

  for (const flagName of PROTOCOL_FILE_FLAGS) {
    const filePath = flagValue(flags, flagName);
    if (!filePath) continue;
    if (filePath === '-') {
      const content = readStdinOnce();
      fileInputs[flagName] = content;
    } else {
      fileInputs[flagName] = readFileSync(filePath, 'utf8');
    }
  }

  return { fileInputs };
}

async function discoverProjectId(runtime: CliRuntime, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const projects = await listAccessibleProjects({ backend: runtime.backend });
  const first = projects[0];
  const id = asRecord(first).id;
  if (typeof id !== 'string') {
    throw new CliError({ message: 'No project found. Create one with `ovld create-project`.' });
  }
  return id;
}

export async function runProtocolCommand({
  runtime,
  subcommand,
  args,
  stdin,
  primaryCommand = 'ovld'
}: {
  runtime: CliRuntime;
  subcommand: string;
  args: string[];
  stdin?: string;
  primaryCommand?: string;
}): Promise<void> {
  const parsed = parseArgs(args);
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printProtocolHelp({ primaryCommand });
    return;
  }

  rejectOversizedInlineJson({ flags: parsed.flags });

  const workingDirectory = process.cwd();
  const flags = Object.fromEntries(parsed.flags);
  const retiredFlags = RETIRED_CHANGE_TRACKING_FLAGS[subcommand] ?? [];
  const suppliedRetiredFlags = retiredFlags.filter(flag => flag in flags);
  if (suppliedRetiredFlags.length > 0) {
    throw new CliError({
      message:
        `${suppliedRetiredFlags.join(', ')} ${suppliedRetiredFlags.length === 1 ? 'was' : 'were'} removed. ` +
        'File evidence is captured and synchronized from the objective ledger.'
    });
  }
  if (
    subcommand === 'attach' &&
    typeof flags['--execution-request-id'] !== 'string' &&
    process.env.OVERLORD_EXECUTION_REQUEST_ID
  ) {
    flags['--execution-request-id'] = process.env.OVERLORD_EXECUTION_REQUEST_ID;
  }
  if (
    OBJECTIVE_SCOPED_SUBCOMMANDS.has(subcommand) &&
    typeof flags['--objective-id'] !== 'string' &&
    process.env.OVERLORD_OBJECTIVE_ID
  ) {
    flags['--objective-id'] = process.env.OVERLORD_OBJECTIVE_ID;
  }
  // The launch path prepared a session channel and exported its id. Attach is what binds that
  // channel to the session it was prepared for, so carry the id through automatically —
  // requiring the agent to pass a flag it never saw would mean the binding silently never
  // happens and the feed stays empty for the exact sessions Overlord itself launched.
  //
  // Only `OVERLORD_SESSION_CHANNEL_ID` is read here. `OVERLORD_SESSION_CHANNEL_TOKEN` is
  // deliberately not: a credential must never become a protocol flag, because flags are argv,
  // and argv is visible to every process on the machine.
  //
  // Agent-pod / `agp` launches often strip the Overlord launch exports from the agent process
  // environment even though they remain in `.overlord/tmp/launch-*.sh`. Recover the non-secret
  // channel id (and execution request id) from that script so attach still binds.
  const explicitMissionId = flagValue(parsed.flags, '--mission-id') ?? parsed.positional[0];
  if (subcommand === 'attach' || OBJECTIVE_SCOPED_SUBCOMMANDS.has(subcommand)) {
    const needsChannelId =
      subcommand === 'attach' && typeof flags['--session-channel-id'] !== 'string';
    const needsExecutionRequestId =
      subcommand === 'attach' && typeof flags['--execution-request-id'] !== 'string';
    const needsObjectiveId = typeof flags['--objective-id'] !== 'string';
    if (needsChannelId && process.env.OVERLORD_SESSION_CHANNEL_ID) {
      flags['--session-channel-id'] = process.env.OVERLORD_SESSION_CHANNEL_ID;
    }
    if (
      (needsChannelId && typeof flags['--session-channel-id'] !== 'string') ||
      (needsExecutionRequestId && typeof flags['--execution-request-id'] !== 'string') ||
      needsObjectiveId
    ) {
      const missionHint =
        (typeof explicitMissionId === 'string' && explicitMissionId.trim()
          ? explicitMissionId.trim()
          : null) ??
        process.env.MISSION_ID ??
        process.env.OVERLORD_MISSION_ID ??
        null;
      if (missionHint) {
        const recovered = recoverLaunchBootstrapFromProjectTmp({
          workingDirectory,
          missionId: missionHint
        });
        if (needsChannelId && recovered.sessionChannelId) {
          flags['--session-channel-id'] = recovered.sessionChannelId;
        }
        if (needsExecutionRequestId && recovered.executionRequestId) {
          flags['--execution-request-id'] = recovered.executionRequestId;
        }
        if (needsObjectiveId && recovered.objectiveId) {
          flags['--objective-id'] = recovered.objectiveId;
        }
      }
    }
  }

  // An objective display id already names its mission (`coo:756.k7xm` ->
  // `coo:756`), so an agent that reconnects holding only the objective it was
  // launched for can address every subcommand with it. Fill `--mission-id` in
  // here rather than leaving it to the backend so the local paths below —
  // session-key cache and objective ledger both require the exact objective.
  const objectiveRef =
    typeof flags['--objective-id'] === 'string' ? flags['--objective-id'] : undefined;
  const missionId =
    explicitMissionId ?? missionDisplayIdFromObjectiveRef(objectiveRef) ?? undefined;
  if (missionId && typeof flags['--mission-id'] !== 'string') {
    flags['--mission-id'] = missionId;
  }
  const { fileInputs } = await resolveProtocolFileInputs({
    flags: parsed.flags,
    stdin
  });
  let explicitSyncIdentity:
    | { objectiveId: string; sessionKey: string; batchEvidence: Set<string> }
    | undefined;

  // Local-only: reduce a connector post-tool payload into direct path evidence.
  // There is no backend call and no worktree scan on this latency-sensitive path.
  if (subcommand === 'capture-change') {
    // The hook payload arrives as raw piped stdin, not a --*-file flag, so read
    // fd 0 directly rather than going through resolveProtocolFileInputs (which
    // only reads stdin when a --*-file flag is literally '-').
    const rawPayload = stdin ?? (process.stdin.isTTY ? null : readBoundedStdin());
    const result = captureChangeFromPayload({
      agent: flagValue(parsed.flags, '--agent') ?? '',
      rawPayload,
      objectiveOverride: objectiveRef ?? process.env.OVERLORD_OBJECTIVE_ID,
      fallbackCwd: workingDirectory
    });
    printJson(result);
    return;
  }

  // Preflight drains the attached objective ledger, then reports its local
  // health. It deliberately does not inspect or classify the shared worktree:
  // a path may belong to more than one objective and peer arbitration is not
  // an attribution mechanism.
  if (subcommand === 'changes') {
    if (!objectiveRef) {
      throw new CliError({
        message: 'Usage: ovld protocol changes --objective-id <id> [--mission-id <id>]'
      });
    }
    if (!missionId) {
      throw new CliError({
        message:
          'Mission scope is required when --objective-id is not a mission-qualified display id.'
      });
    }
    const sessionKey =
      (typeof flags['--session-key'] === 'string' && flags['--session-key']) ||
      (objectiveRef
        ? readCachedSessionKey({ missionId, workingDirectory, objectiveId: objectiveRef })
        : undefined);
    const objectiveSessions = objectiveRef
      ? readObjectiveSessions({ workingDirectory, objectiveId: objectiveRef })
      : [];
    const explicitSessionKey =
      typeof flags['--session-key'] === 'string' ? flags['--session-key'] : undefined;
    const explicitSessionMatches =
      !explicitSessionKey ||
      objectiveSessions.some(entry => entry.sessionKey === explicitSessionKey);
    const candidates = explicitSessionMatches ? objectiveSessions : [];
    const selected =
      (sessionKey ? objectiveSessions.find(entry => entry.sessionKey === sessionKey) : undefined) ??
      objectiveSessions.find(entry => !entry.deliveryPendingSync);
    let synced = 0;
    const warnings: string[] = [];
    for (const entry of candidates) {
      const result = await syncObjectiveLedger({
        runtime,
        workingDirectory,
        missionId,
        sessionKey: entry.sessionKey,
        active: entry
      });
      synced += result.synced;
      if (result.warning && !warnings.includes(result.warning)) warnings.push(result.warning);
    }
    let unsyncedEvidence = 0;
    const allHealth = candidates.flatMap(entry => {
      unsyncedEvidence += readUnsyncedChangeEvidence({
        workingDirectory,
        objectiveId: entry.objectiveId,
        sessionKey: entry.sessionKey
      }).length;
      return readChangeLedgerHealth({
        workingDirectory,
        objectiveId: entry.objectiveId,
        sessionKey: entry.sessionKey
      });
    });
    const health = allHealth
      .sort((left, right) => left.at.localeCompare(right.at))
      .slice(-MAX_CHANGES_HEALTH_ENTRIES);
    for (const entry of candidates.filter(candidate => candidate.deliveryPendingSync)) {
      const stillUnsynced = readUnsyncedChangeEvidence({
        workingDirectory,
        objectiveId: entry.objectiveId,
        sessionKey: entry.sessionKey
      });
      if (stillUnsynced.length > 0) continue;
      const finalized = finalizeActiveSession({
        workingDirectory,
        objectiveId: entry.objectiveId,
        sessionKey: entry.sessionKey
      });
      if (finalized) {
        clearCachedSessionKey({
          missionId,
          workingDirectory,
          objectiveId: objectiveRef,
          sessionKey: entry.sessionKey
        });
      }
    }
    if (readActiveSessions(workingDirectory).length === 0) {
      clearActiveMissionPointer(workingDirectory);
    }
    printJson({
      objectiveId: selected?.objectiveId ?? objectiveSessions[0]?.objectiveId ?? null,
      synced,
      warning:
        candidates.length === 0
          ? 'no attached objective session'
          : warnings.length > 0
            ? warnings.join('; ')
            : null,
      unsyncedEvidence,
      health
    });
    return;
  }

  // Session-key cache: when a command that needs a session key is missing the
  // flag, fall back to the key cached at attach for this (workingDir, mission).
  // An explicit --session-key always wins.
  if (
    SESSION_KEY_SUBCOMMANDS.has(subcommand) &&
    missionId &&
    objectiveRef &&
    (typeof flags['--session-key'] !== 'string' || flags['--session-key'].trim() === '')
  ) {
    const cached = readCachedSessionKey({
      missionId,
      workingDirectory,
      objectiveId: objectiveRef
    });
    if (cached) flags['--session-key'] = cached;
  }

  // `sync-changes` is a retryable local-ledger drain. The normal agent never
  // writes this payload: the CLI supplies at most 25 unsynced metadata-only
  // entries and retains anything the server does not accept for a later retry.
  if (subcommand === 'sync-changes' && missionId) {
    const sessionKey = typeof flags['--session-key'] === 'string' ? flags['--session-key'] : null;
    const active = sessionKey
      ? readActiveSessions(workingDirectory).find(entry => entry.sessionKey === sessionKey)
      : undefined;
    if (!sessionKey || !active) {
      throw new CliError({
        message: 'sync-changes requires an attached objective session in this working directory.'
      });
    }
    const unsynced = readUnsyncedChangeEvidence({
      workingDirectory,
      objectiveId: active.objectiveId,
      sessionKey
    });
    if (
      typeof flags['--changes-json'] !== 'string' &&
      typeof flags['--changes-file'] !== 'string'
    ) {
      flags['--changes-json'] = JSON.stringify(unsynced.slice(0, 25));
    }
    const suppliedEvidence = changeBatchEvidenceIdentities(
      typeof flags['--changes-json'] === 'string'
        ? flags['--changes-json']
        : fileInputs['--changes-file'],
      unsynced
    );
    explicitSyncIdentity = {
      objectiveId: active.objectiveId,
      sessionKey,
      batchEvidence: suppliedEvidence
    };
  }

  pruneStaleProjectTmp({ workingDirectory });

  let lifecycleActive: { missionId: string; objectiveId: string; sessionKey: string } | undefined;
  if ((subcommand === 'deliver' || subcommand === 'update') && missionId) {
    const sessionKey = typeof flags['--session-key'] === 'string' ? flags['--session-key'] : null;
    const active = sessionKey
      ? readActiveSessions(workingDirectory).find(entry => entry.sessionKey === sessionKey)
      : undefined;
    lifecycleActive = active;
    appendDeclaredOutputPaths({ flags, active, workingDirectory });
    if (sessionKey && active) {
      await syncObjectiveLedger({ runtime, workingDirectory, missionId, sessionKey, active });
    }
  }

  // Hosted backends cannot walk the agent machine's filesystem for discovery.
  if (subcommand === 'discover-project' && !isLoopbackBackendUrl(runtime.backend.baseUrl)) {
    const discovery = await discoverProjectOnClient({
      backend: runtime.backend,
      workingDirectory: flagValue(parsed.flags, '--directory') ?? workingDirectory,
      projectId: flagValue(parsed.flags, '--project-id')
    });
    printJson(discovery);
    return;
  }

  if (
    (subcommand === 'attach' ||
      subcommand === 'load-context' ||
      subcommand === 'resume-follow-up') &&
    typeof flags['--execution-target-id'] !== 'string'
  ) {
    const preferredTargetId = await resolvePreferredExecutionTargetId({ backend: runtime.backend });
    if (preferredTargetId) {
      flags['--execution-target-id'] = preferredTargetId;
    }
  }

  const protocolBody = {
    args,
    positional: parsed.positional,
    flags,
    fileInputs,
    externalSessionId:
      flagValue(parsed.flags, '--external-session-id') ??
      resolveNativeSessionId({
        explicit: undefined,
        agent: flagValue(parsed.flags, '--agent') ?? 'unknown',
        missionId: missionId ?? 'unknown',
        workingDirectory,
        objectiveId: objectiveRef
      })
  };

  const protocolPath = `/api/protocol/${encodeURIComponent(subcommand)}`;
  let result: unknown;
  try {
    result = await runtime.backend.post<unknown>({
      path: protocolPath,
      body: protocolBody
    });
  } catch (error) {
    // Agent-pod / `agp` recovers OVERLORD_EXECUTION_REQUEST_ID from the launch
    // script. If the runner already cleared that request, attach would otherwise
    // fail before writeActiveSession, and the objective capture hook would stay inert.
    if (
      subcommand === 'attach' &&
      typeof flags['--execution-request-id'] === 'string' &&
      isUnlinkableExecutionRequestError(error)
    ) {
      delete flags['--execution-request-id'];
      result = await runtime.backend.post<unknown>({
        path: protocolPath,
        body: { ...protocolBody, flags }
      });
    } else if (isExecutionRequestAlreadyLinkedError(error)) {
      throw new CliError({ message: formatExecutionRequestAlreadyLinkedDiagnostic() });
    } else {
      throw error;
    }
  }

  const resultRecord = asRecord(result);

  if (subcommand === 'sync-changes' && missionId && explicitSyncIdentity) {
    const outcomes = asRecord(resultRecord).outcomes;
    if (Array.isArray(outcomes)) {
      const accepted = new Map<string, ChangeEvidenceIdentity>(
        outcomes.flatMap(outcome => {
          const record = asRecord(outcome);
          if (
            (record.status !== 'accepted' && record.status !== 'ignored') ||
            typeof record.idempotencyKey !== 'string' ||
            typeof record.filePath !== 'string'
          ) {
            return [];
          }
          const identity = {
            idempotencyKey: record.idempotencyKey,
            filePath: record.filePath
          };
          const key = changeEvidenceIdentityKey(identity);
          return explicitSyncIdentity?.batchEvidence.has(key) ? [[key, identity] as const] : [];
        })
      );
      const active = readActiveSessions(workingDirectory).find(
        entry =>
          entry.objectiveId === explicitSyncIdentity?.objectiveId &&
          entry.sessionKey === explicitSyncIdentity?.sessionKey
      );
      if (active && accepted.size > 0) {
        markChangeEvidenceSynced({
          workingDirectory,
          objectiveId: active.objectiveId,
          sessionKey: active.sessionKey,
          evidence: [...accepted.values()]
        });
      }
    }
  }
  if (typeof resultRecord.sessionKey === 'string') {
    printKeyValue({ SESSION_KEY: resultRecord.sessionKey });
    // Persist the freshly minted key so subsequent commands in other shells for
    // this (workingDir, mission) can auto-resolve it without --session-key.
    if (missionId) {
      const attachedObjective = asRecord(resultRecord.objective);
      const attachedObjectiveId =
        (typeof attachedObjective.displayId === 'string' && attachedObjective.displayId.trim()) ||
        (typeof attachedObjective.id === 'string' && attachedObjective.id.trim()) ||
        // `connect` returns a flat result rather than the full objective record.
        (typeof resultRecord.objectiveDisplayId === 'string' &&
          resultRecord.objectiveDisplayId.trim()) ||
        (typeof resultRecord.objectiveId === 'string' && resultRecord.objectiveId.trim()) ||
        objectiveRef ||
        null;
      const objectiveAliases = new Set(
        [
          attachedObjectiveId,
          typeof attachedObjective.id === 'string' ? attachedObjective.id.trim() : null,
          typeof attachedObjective.displayId === 'string'
            ? attachedObjective.displayId.trim()
            : null,
          objectiveRef ?? null
        ].filter((value): value is string => Boolean(value))
      );
      for (const objectiveAlias of objectiveAliases) {
        writeCachedSessionKey({
          missionId,
          workingDirectory,
          sessionKey: resultRecord.sessionKey,
          objectiveId: objectiveAlias
        });
      }
      // Store the exact objective binding used by capture-change. The hook must
      // still supply this objective; cwd never chooses an entry.
      if ((subcommand === 'attach' || subcommand === 'resume-follow-up') && attachedObjectiveId) {
        const objectiveIdentity =
          (typeof attachedObjective.id === 'string' && attachedObjective.id.trim()) ||
          attachedObjectiveId;
        writeActiveSession({
          workingDirectory,
          missionId,
          objectiveId: objectiveIdentity,
          objectiveAliases: [...objectiveAliases],
          sessionKey: resultRecord.sessionKey
        });
      }
    }
  }

  // Attach / connect / resume: retain the local mission identity needed by
  // agent-session binding and edit-attribution paths.
  if (subcommand === 'attach' || subcommand === 'connect' || subcommand === 'resume-follow-up') {
    const missionRecord = asRecord(resultRecord.mission);
    // Prefer the response display id, then the caller-supplied --mission-id
    // (often already a display id like coo:502), and only then the UUID.
    const displayId =
      (typeof missionRecord.displayId === 'string' && missionRecord.displayId.trim()) ||
      (typeof missionId === 'string' && missionId.trim()) ||
      (typeof resultRecord.missionId === 'string' && resultRecord.missionId.trim()) ||
      '';
    const title = typeof missionRecord.title === 'string' ? missionRecord.title : undefined;
    const pointerMissionId =
      (typeof missionRecord.id === 'string' && missionRecord.id.trim()) ||
      (typeof resultRecord.missionId === 'string' && resultRecord.missionId.trim()) ||
      displayId;
    if (displayId) {
      writeActiveMissionPointer({
        workingDirectory,
        missionId: pointerMissionId,
        displayId,
        title
      });
    }
  }

  // The session ends at deliver only after its exact ledger is fully synced.
  // Failed ledger cleanup retains the binding and cache for `changes` retries.
  if (subcommand === 'deliver' && missionId) {
    const deliveredSessionKey =
      typeof flags['--session-key'] === 'string' ? flags['--session-key'] : undefined;
    const deliveredActive = deliveredSessionKey
      ? (readActiveSessions(workingDirectory).find(
          entry => entry.sessionKey === deliveredSessionKey
        ) ?? lifecycleActive)
      : undefined;
    const finalized =
      deliveredActive && deliveredSessionKey
        ? finalizeActiveSession({
            workingDirectory,
            objectiveId: deliveredActive.objectiveId,
            sessionKey: deliveredSessionKey
          })
        : true;
    if (finalized) {
      clearCachedSessionKey({
        missionId,
        workingDirectory,
        objectiveId: objectiveRef,
        sessionKey: deliveredSessionKey ?? null
      });
      if (readActiveSessions(workingDirectory).length === 0) {
        clearActiveMissionPointer(workingDirectory);
      }
    }
  }
  if (typeof resultRecord.missionId === 'string') {
    printKeyValue({ MISSION_ID: resultRecord.missionId });
  }

  // Make attachment URLs absolute by prepending the backend base URL so agents
  // can use them directly with curl without guessing the backend address.
  if (subcommand === 'attachment-download-url') {
    const relUrl = resultRecord.url;
    if (typeof relUrl === 'string' && relUrl.startsWith('/')) {
      printJson({ ...resultRecord, url: `${runtime.backend.baseUrl}${relUrl}` });
      return;
    }
  }
  if (subcommand === 'attachment-list' && Array.isArray(result)) {
    const baseUrl = runtime.backend.baseUrl;
    const enhanced = result.map(entry => {
      const rec = asRecord(entry);
      const relUrl = rec.url;
      return typeof relUrl === 'string' && relUrl.startsWith('/')
        ? { ...rec, url: `${baseUrl}${relUrl}` }
        : rec;
    });
    printJson(enhanced);
    return;
  }

  printJson(result);
}

export async function runManagementCommand({
  runtime,
  command,
  rest
}: {
  runtime?: CliRuntime;
  command: string;
  rest: string[];
}): Promise<void> {
  if (!runtime) throw new CliError({ message: `Command requires a backend: ${command}` });

  const parsed = parseArgs(rest);
  const json = flagBoolean(parsed.flags, '--json');

  switch (command) {
    case 'create-project': {
      const name = flagValue(parsed.flags, '--name') ?? parsed.positional.join(' ');
      if (!name) throw new CliError({ message: 'Missing --name' });
      const project = await runtime.backend.post<unknown>({
        path: '/api/projects',
        body: { name }
      });
      const projectId = asRecord(project).id;
      if (!flagBoolean(parsed.flags, '--no-directory') && typeof projectId === 'string') {
        const directory = flagValue(parsed.flags, '--directory') ?? process.cwd();
        const resource = await runtime.backend.post({
          path: `/api/projects/${encodeURIComponent(projectId)}/resources`,
          body: {
            directoryPath: directory,
            isPrimary: true
          }
        });
        const createdName = asRecord(project).name;
        writeProjectJsonFromResource({
          directory,
          projectId,
          projectName: typeof createdName === 'string' ? createdName : null,
          resource
        });
      }
      if (json) printJson({ project });
      else
        console.log(
          `Created project ${asRecord(project).name ?? name} (${projectId ?? 'unknown'})`
        );
      return;
    }
    case 'org-setup': {
      await runOrgSetupCommand({ runtime, parsed });
      return;
    }
    case 'add-cwd': {
      const directory = flagValue(parsed.flags, '--directory') ?? process.cwd();
      const existingLinks = readProjectJsonLinks(path.join(directory, '.overlord', 'project.json'));
      let projectId = flagValue(parsed.flags, '--project-id');
      if (!projectId) {
        const allProjects = await listAccessibleProjects({ backend: runtime.backend });
        const projects = allProjects.filter(project => project.status !== 'archived');
        if (projects.length === 0) {
          throw new CliError({
            message: 'No project found. Create one with `ovld create-project`.'
          });
        }
        if (process.stdin.isTTY) {
          const chosen = await promptForProject({ projects, directoryPath: directory });
          if (!chosen) {
            console.log('Cancelled. No changes made.');
            return;
          }
          projectId = chosen.id;
        } else {
          projectId = projects[0]?.id;
        }
      }
      if (!projectId) throw new CliError({ message: 'No project selected.' });
      const matchingLink = existingLinks.find(link => link.projectId === projectId);
      const resourceKey =
        flagValue(parsed.flags, '--key') ??
        matchingLink?.resourceKey ??
        existingLinks[0]?.resourceKey;
      const resource = await runtime.backend.post({
        path: `/api/projects/${encodeURIComponent(projectId)}/resources`,
        body: {
          directoryPath: directory,
          ...(resourceKey ? { resourceKey } : {}),
          isPrimary: flagValue(parsed.flags, '--primary') !== 'false',
          ...resourceAccessModeBody(flagValue(parsed.flags, '--access'))
        }
      });
      writeProjectJsonFromResource({ directory, projectId, resource });
      if (json) printJson({ resource });
      else console.log(`Linked ${directory} to project ${projectId}`);
      return;
    }
    case 'add-url': {
      const sourceUrl = flagValue(parsed.flags, '--url');
      if (!sourceUrl) throw new CliError({ message: 'Missing --url <git-url>' });
      const projectId = flagValue(parsed.flags, '--project-id');
      if (!projectId) throw new CliError({ message: 'Missing --project-id for URL resources.' });
      const resource = await runtime.backend.post({
        path: `/api/projects/${encodeURIComponent(projectId)}/resources`,
        body: {
          sourceUrl,
          resourceKey: flagValue(parsed.flags, '--key'),
          isPrimary: flagValue(parsed.flags, '--primary') !== 'false',
          ...resourceAccessModeBody(flagValue(parsed.flags, '--access'))
        }
      });
      if (json) printJson({ resource });
      else console.log(`Linked ${sourceUrl} to project ${projectId}`);
      return;
    }
    case 'add-et': {
      // Announce the acting machine as an execution target, independent of any
      // launch/claim/resource-linking activity. Routes through the parentless
      // `register-target` protocol handler; the backend client attaches this
      // device's fingerprint/label headers automatically, so the server
      // provisions (or reuses) the target for THIS machine.
      const name = flagValue(parsed.flags, '--name') ?? parsed.positional.join(' ');
      const protocolFlags: Record<string, string> = {};
      if (name) protocolFlags['--name'] = name;
      const workspaceId = flagValue(parsed.flags, '--workspace-id');
      if (workspaceId) protocolFlags['--workspace-id'] = workspaceId;

      const result = await runtime.backend.post<unknown>({
        path: '/api/protocol/register-target',
        body: { args: rest, positional: parsed.positional, flags: protocolFlags, fileInputs: {} }
      });
      const record = asRecord(result);

      if (record.status === 'workspace_selection_required') {
        if (json) {
          printJson({ result });
        } else {
          const workspaces = Array.isArray(record.workspaces) ? record.workspaces : [];
          console.log(
            'You belong to more than one workspace. Re-run with --workspace-id set to one of:'
          );
          for (const entry of workspaces) {
            const ws = asRecord(entry);
            console.log(`  - ${ws.name ?? ws.id} (${ws.slug ?? ws.id})`);
          }
        }
        return;
      }

      if (json) {
        printJson({ result });
      } else {
        const target = asRecord(record.executionTarget);
        const ws = asRecord(record.workspace);
        console.log(
          `Registered execution target ${target.label ?? name ?? ''} ` +
            `(${target.executionTargetId ?? 'unknown'}) in workspace ${ws.name ?? ws.id ?? ''}`
        );
      }
      return;
    }
    case 'create':
    case 'prompt': {
      const objectivesJson = flagValue(parsed.flags, '--objectives-json');
      const objective =
        parsed.positional.join(' ') ||
        flagValue(parsed.flags, '--objective') ||
        flagValue(parsed.flags, '--prompt');
      const projectId = await discoverProjectId(runtime, flagValue(parsed.flags, '--project-id'));
      const autoAdvance = flagOptionalBoolean({
        flags: parsed.flags,
        name: '--auto-advance',
        negatedName: '--no-auto-advance'
      });
      const parsedObjectives = objectivesJson
        ? (JSON.parse(objectivesJson) as Array<{
            objective: string;
            title?: string | null;
            autoAdvance?: boolean;
            resourceKey?: string | null;
          }>)
        : null;
      const objectives = parsedObjectives
        ? parsedObjectives.map(item => ({
            ...item,
            ...(item.autoAdvance === undefined && autoAdvance !== undefined ? { autoAdvance } : {})
          }))
        : objective
          ? [
              {
                objective,
                title: flagValue(parsed.flags, '--title') ?? null,
                ...(autoAdvance !== undefined ? { autoAdvance } : {}),
                ...(flagValue(parsed.flags, '--resource')
                  ? { resourceKey: flagValue(parsed.flags, '--resource') }
                  : {})
              }
            ]
          : [];
      const first = objectives[0];
      if (!first) {
        throw new CliError({
          message: objectivesJson
            ? 'objectives-json must contain at least one objective'
            : 'Missing objective prompt text'
        });
      }

      const title = flagValue(parsed.flags, '--title') ?? first.title ?? first.objective;
      const mission = await runtime.backend.post<unknown>({
        path: '/api/missions',
        body: {
          projectId,
          title,
          objectives
        }
      });
      if (objectivesJson) {
        const missionObjectives = asRecord(mission).objectives;
        if (Array.isArray(missionObjectives) && missionObjectives.length !== objectives.length) {
          throw new CliError({
            message: `Backend created ${missionObjectives.length} objective(s), expected ${objectives.length}`
          });
        }
      }
      if (command === 'prompt') {
        const objectiveId = firstObjectiveId(mission);
        if (objectiveId) {
          await runtime.backend.post({
            path: `/api/objectives/${encodeURIComponent(objectiveId)}/launch`,
            body: { agent: flagValue(parsed.flags, '--agent') ?? 'unknown' }
          });
        }
      }
      if (json) printJson(mission);
      else console.log(`Created mission ${missionDisplayId(mission)}`);
      return;
    }
    case 'attach':
    case 'execution': {
      const objectiveRef = flagValue(parsed.flags, '--objective-id');
      const missionId =
        (command === 'attach'
          ? (parsed.positional[0] ?? flagValue(parsed.flags, '--mission-id'))
          : flagValue(parsed.flags, '--mission-id')) ??
        missionDisplayIdFromObjectiveRef(objectiveRef);
      const explicitAgent = parsed.positional[1] ?? flagValue(parsed.flags, '--agent');
      if (!missionId) {
        throw new CliError({
          message: `Usage: ovld ${command} <missionId> [agent] (or --objective-id <mission-display-id>.<key>)`
        });
      }
      const mission = await runtime.backend.get<unknown>(
        `/api/missions/${encodeURIComponent(missionId)}`
      );
      const objectiveId = objectiveRef
        ? objectiveIdForRef(mission, objectiveRef)
        : queueableObjectiveId(mission);
      if (!objectiveId)
        throw new CliError({ message: `No launchable objective found for ${missionId}` });
      // Honor an explicit agent; otherwise reuse the agent already stored on the
      // objective (the db is the source of truth) so launching never overrides the
      // chosen agent, and fall back to the configured default rather than codex.
      const agent =
        explicitAgent ?? objectiveAssignedAgent(mission, objectiveId) ?? loadConfig().defaultAgent;
      const request = await runtime.backend.post({
        path: `/api/objectives/${encodeURIComponent(objectiveId)}/launch`,
        body: {
          agent,
          model: flagValue(parsed.flags, '--model'),
          reasoningEffort: flagValue(parsed.flags, '--thinking')
        }
      });
      if (json) printJson({ request });
      else console.log(`Delegated ${agent} for ${missionDisplayId(mission)}`);
      return;
    }
    case 'launch':
    case 'restart':
    case 'run':
    case 'connect':
    case 'resume': {
      const agent =
        command === 'run' || command === 'connect' || command === 'resume'
          ? (flagValue(parsed.flags, '--agent') ??
            parsed.positional[0] ??
            loadConfig().defaultAgent)
          : parsed.positional[0];
      const objectiveRef = flagValue(parsed.flags, '--objective-id');
      // `--objective-id coo:756.k7xm` is a complete address, so a caller who was
      // handed only the objective (the reconnect case) does not need to restate
      // the mission it belongs to.
      const missionId =
        flagValue(parsed.flags, '--mission-id') ??
        parsed.positional[1] ??
        missionDisplayIdFromObjectiveRef(objectiveRef) ??
        undefined;
      if (!agent || !missionId) {
        throw new CliError({
          message: `Usage: ovld ${command} <agent> --mission-id <missionId> (or --objective-id <mission-display-id>.<key>)`
        });
      }
      const workingDirectory = flagValue(parsed.flags, '--working-directory') ?? process.cwd();
      const dryRun = flagBoolean(parsed.flags, '--dry-run');
      const mission = await runtime.backend.get<unknown>(
        `/api/missions/${encodeURIComponent(missionId)}`
      );
      const scopedRuntime: CliRuntime = runtime;
      // The mission's own workspace owns its launch settings; passing it keeps a
      // secondary-workspace launch on the same terminal profile as its runner.
      const missionWorkspaceId =
        typeof asRecord(mission).workspaceId === 'string'
          ? (asRecord(mission).workspaceId as string)
          : null;
      const terminal = await resolveTerminalLaunchSettings({
        runtime: scopedRuntime,
        flags: parsed.flags,
        workspaceId: missionWorkspaceId
      });
      const objectiveId = objectiveRef
        ? objectiveIdForRef(mission, objectiveRef)
        : resolveActiveObjectiveId(mission);
      const executionTargetId = await resolvePreferredExecutionTargetId({
        backend: scopedRuntime.backend,
        workspaceId: missionWorkspaceId
      });
      // Per-project pre-launch commands and launch env vars run/apply before the
      // agent starts. Resolved from the mission's project so a manual launch
      // behaves like a runner one.
      const missionProjectId = asRecord(mission).projectId;
      const projectLaunchSettings =
        typeof missionProjectId === 'string'
          ? await scopedRuntime.backend
              .get<unknown>(`/api/projects/${encodeURIComponent(missionProjectId)}`)
              .then(project => ({
                preLaunchCommands: parsePreLaunchCommandsValue(asRecord(project).preLaunchCommands),
                launchEnvVars: parseLaunchEnvVarsValue(asRecord(project).launchEnvVars)
              }))
              .catch(() => ({
                preLaunchCommands: [] as string[],
                launchEnvVars: {} as Record<string, string>
              }))
          : { preLaunchCommands: [] as string[], launchEnvVars: {} as Record<string, string> };
      const preLaunchCommands = projectLaunchSettings.preLaunchCommands;
      const launchEnvVars = projectLaunchSettings.launchEnvVars;
      const prepared = await prepareMissionBranch({
        runtime: scopedRuntime,
        options: {
          missionId,
          workingDirectory,
          objectiveId: objectiveId ?? undefined,
          automationEnabled: await readWorktreeBranchAutomationEnabled(scopedRuntime),
          dryRun,
          overrideBranch: flagValue(parsed.flags, '--branch'),
          noWorktree: flagBoolean(parsed.flags, '--no-worktree')
        }
      });
      await recordBranchPrepared({
        runtime: scopedRuntime,
        missionId,
        branchAutomation: prepared.branchAutomation
      });

      const result = await launchAgent({
        runtime: scopedRuntime,
        options: {
          agent,
          missionId,
          workingDirectory: prepared.workingDirectory,
          model: flagValue(parsed.flags, '--model'),
          thinking: flagValue(parsed.flags, '--thinking'),
          flags: repeatedLaunchFlags(rest, '--flag'),
          preCommand: flagValue(parsed.flags, '--pre-command'),
          preLaunchCommands: preLaunchCommands.length > 0 ? preLaunchCommands : undefined,
          launchEnvVars: Object.keys(launchEnvVars).length > 0 ? launchEnvVars : undefined,
          executionTargetId: executionTargetId ?? undefined,
          objectiveId: objectiveId ?? undefined,
          ...terminal,
          dryRun
        }
      });
      if (json || dryRun) {
        printJson({ plan: result.plan, status: result.status, signal: result.signal });
      }
      if (result.status && result.status !== 0) {
        throw new CliError({
          message: launchFailureMessage({
            status: result.status,
            execution: result.plan.execution,
            terminal
          })
        });
      }
      return;
    }
    case 'runner': {
      await runRunnerCommand({ runtime, parsed, json });
      return;
    }
    case 'missions': {
      const sub = parsed.positional[0];
      if (sub !== 'list') {
        throw new CliError({
          message:
            'Usage: ovld missions list [--status <csv>] [--project-id <id|slug|name>] ' +
            '[--workspace-id <id|slug|name>] [--json]'
        });
      }
      const params = new URLSearchParams();
      const query = flagValue(parsed.flags, '--query');
      // Search accepts a project the way the user says it. The REST filter is
      // UUID-only, so resolve here rather than making people look up an id.
      const projectRef = flagValue(parsed.flags, '--project-id');
      const projectId = projectRef
        ? (
            await resolveProjectByIdOrName({
              backend: runtime.backend,
              projectRef,
              workspaceRef: flagValue(parsed.flags, '--workspace-id')
            })
          ).id
        : undefined;
      const limit = flagValue(parsed.flags, '--limit');
      // `--status` filters status *types* (draft/execute/review/complete/
      // blocked/cancelled), never the project-defined status names shown on a
      // board. Names vary per project (coo:752); types do not.
      const statusTypes = (flagValue(parsed.flags, '--status') ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(value => value !== '');
      if (query) params.set('q', query);
      if (projectId) params.set('projectId', projectId);
      if (statusTypes.length > 0) params.set('statusTypes', statusTypes.join(','));
      if (limit) params.set('limit', limit);
      let missions: unknown[];
      const result = await runtime.backend.get<{ missions: unknown[] }>(
        `/api/missions/search?${params}`
      );
      missions = result.missions;
      if (json) printJson({ missions });
      else {
        for (const mission of missions) {
          const record = asRecord(mission);
          console.log(
            `${record.displayId ?? record.id}\t${record.statusType ?? ''}\t${record.title ?? ''}`
          );
        }
      }
      return;
    }
    // Board columns are project-scoped (coo:752): two projects in one workspace
    // may name and order their statuses differently, so the only way to discover
    // a board's columns is to ask the project that owns them. Read-only —
    // status definitions are edited in project settings.
    case 'statuses': {
      const sub = parsed.positional[0];
      if (sub !== 'list') {
        throw new CliError({
          message: 'Usage: ovld statuses list --project-id <id|slug|name> [--json]'
        });
      }
      const projectRef = flagValue(parsed.flags, '--project-id');
      if (!projectRef) {
        throw new CliError({
          message: 'Missing --project-id (accepts a project id, slug, or name)'
        });
      }
      const project = await resolveProjectByIdOrName({
        backend: runtime.backend,
        projectRef,
        workspaceRef: flagValue(parsed.flags, '--workspace-id')
      });
      const statuses = await runtime.backend.get<unknown[]>(
        `/api/projects/${encodeURIComponent(project.id)}/statuses`
      );
      if (json) printJson({ projectId: project.id, statuses });
      else {
        for (const status of statuses) {
          const record = asRecord(status);
          const flags = [
            record.isDefault === true ? 'default' : null,
            record.isTerminal === true ? 'terminal' : null
          ]
            .filter(Boolean)
            .join(',');
          console.log(
            `${record.position ?? ''}\t${record.key ?? ''}\t${record.name ?? ''}\t${record.type ?? ''}\t${flags}`
          );
        }
      }
      return;
    }
    case 'requests': {
      const sub = parsed.positional[0];
      if (!sub) {
        const objectiveRef = flagValue(parsed.flags, '--objective-id');
        const missionId =
          flagValue(parsed.flags, '--mission-id') ?? missionDisplayIdFromObjectiveRef(objectiveRef);
        const params = new URLSearchParams();
        if (missionId) params.set('missionId', missionId);
        if (objectiveRef) params.set('objectiveId', objectiveRef);
        const query = params.size > 0 ? `?${params.toString()}` : '';
        const result = await runtime.backend.get<{ requests: unknown[] }>(
          `/api/agent-requests${query}`
        );
        if (json) printJson(result);
        else {
          for (const item of result.requests) {
            const request = asRecord(item);
            console.log(
              `${request.id}\t${request.status}\t${request.kind}\t${request.summary}\trev ${request.revision}`
            );
          }
        }
        return;
      }
      if (sub !== 'resolve') {
        throw new CliError({
          message:
            'Usage: ovld requests [--json] | ovld requests resolve <id> --revision <n> --decision allow|deny|ask [--text <text>]'
        });
      }
      const requestId = parsed.positional[1];
      const revision = Number(flagValue(parsed.flags, '--revision'));
      const decision = flagValue(parsed.flags, '--decision');
      if (
        !requestId ||
        !Number.isInteger(revision) ||
        !decision ||
        !['allow', 'deny', 'ask'].includes(decision)
      ) {
        throw new CliError({
          message:
            'Usage: ovld requests resolve <id> --revision <n> --decision allow|deny|ask [--text <text>]'
        });
      }
      const text = flagValue(parsed.flags, '--text');
      const result = await runtime.backend.post<unknown>({
        path: `/api/agent-requests/${encodeURIComponent(requestId)}/resolve`,
        body: {
          expectedRevision: revision,
          resolution: { decision, ...(text ? { text } : {}) }
        }
      });
      if (json) printJson(result);
      else {
        const record = asRecord(result);
        console.log(
          record.resolved === true
            ? 'Decision submitted.'
            : 'Request was already resolved or released.'
        );
      }
      return;
    }
    case 'inputs': {
      const sub = parsed.positional[0];
      if (!sub || sub === 'list') {
        const missionId =
          flagValue(parsed.flags, '--mission-id') ??
          parsed.positional[1] ??
          missionDisplayIdFromObjectiveRef(flagValue(parsed.flags, '--objective-id'));
        if (!missionId) {
          throw new CliError({
            message:
              'Usage: ovld inputs list --mission-id <id> [--json] | ovld inputs send --channel-id <id> --body <text> [--json]'
          });
        }
        const objectiveRef = flagValue(parsed.flags, '--objective-id');
        const params = new URLSearchParams({ missionId });
        if (objectiveRef) params.set('objectiveId', objectiveRef);
        const result = await runtime.backend.get<{ inputs: unknown[] }>(
          `/api/agent-session-inputs?${params.toString()}`
        );
        if (json) printJson(result);
        else {
          for (const item of result.inputs) {
            const input = asRecord(item);
            // deliveryLabel is the honest UI string — Cursor turn-boundary reads
            // "Queued (turn boundary)", never "Delivered".
            console.log(
              `${input.id}\t${input.deliveryLabel ?? input.status}\t${input.kind}\t${String(input.body ?? '').slice(0, 80)}`
            );
          }
        }
        return;
      }
      if (sub === 'send') {
        const channelId = flagValue(parsed.flags, '--channel-id');
        const body = flagValue(parsed.flags, '--body');
        if (!channelId || !body) {
          throw new CliError({
            message: 'Usage: ovld inputs send --channel-id <id> --body <text> [--json]'
          });
        }
        const result = await runtime.backend.post<{ input: Record<string, unknown> }>({
          path: '/api/agent-session-inputs',
          body: { channelId, body, kind: flagValue(parsed.flags, '--kind') ?? 'instruction' }
        });
        if (json) printJson(result);
        else {
          console.log(
            `Queued input ${result.input.id} (${result.input.deliveryLabel ?? result.input.status})`
          );
        }
        return;
      }
      throw new CliError({
        message:
          'Usage: ovld inputs list --mission-id <id> [--json] | ovld inputs send --channel-id <id> --body <text> [--json]'
      });
    }
    case 'mission': {
      const sub = parsed.positional[0];
      // Mission read commands take an objective display id too: it names the
      // mission, and it is the identifier an agent is most likely holding.
      const missionRef = parsed.positional[1];
      const missionId = missionRef
        ? (missionDisplayIdFromObjectiveRef(missionRef) ?? missionRef)
        : undefined;
      if (!missionId) {
        throw new CliError({
          message:
            'Usage: ovld mission context|events|deliveries|artifacts|rationales <missionId> [--json]'
        });
      }
      const pathBySub: Record<string, string> = {
        context: `/api/missions/${encodeURIComponent(missionId)}`,
        events: `/api/missions/${encodeURIComponent(missionId)}/events`,
        artifacts: `/api/missions/${encodeURIComponent(missionId)}/artifacts`,
        rationales: `/api/missions/${encodeURIComponent(missionId)}/file-changes`,
        deliveries: `/api/missions/${encodeURIComponent(missionId)}/deliveries`
      };
      const path = sub ? pathBySub[sub] : undefined;
      if (!path) {
        throw new CliError({
          message:
            'Usage: ovld mission context|events|deliveries|artifacts|rationales <missionId> [--json]'
        });
      }
      const result = await runtime.backend.get<unknown>(path);
      if (json || sub === 'context') printJson(result);
      else if (Array.isArray(result)) for (const row of result) console.log(JSON.stringify(row));
      else printJson(result);
      return;
    }
    case 'changes': {
      const sub = parsed.positional[0];
      const objectiveRef = flagValue(parsed.flags, '--objective-id');
      const missionId =
        flagValue(parsed.flags, '--mission-id') ?? missionDisplayIdFromObjectiveRef(objectiveRef);
      if (!missionId) {
        throw new CliError({
          message:
            'Usage: ovld changes status|rationales --mission-id <id> (or --objective-id <mission-display-id>.<key>)'
        });
      }
      if (sub !== 'status' && sub !== 'rationales') {
        throw new CliError({ message: 'Usage: ovld changes status|rationales --mission-id <id>' });
      }
      const all = await runtime.backend.get<unknown[]>(
        `/api/missions/${encodeURIComponent(missionId)}/file-changes`
      );
      // The route is mission-scoped and each row carries its objective, so
      // narrow here rather than making `--objective-id` a flag that parses and
      // then quietly does nothing.
      let result = all;
      if (objectiveRef) {
        const mission = await runtime.backend.get<unknown>(
          `/api/missions/${encodeURIComponent(missionId)}`
        );
        const objectiveId = objectiveIdForRef(mission, objectiveRef);
        result = all.filter(row => asRecord(row).objectiveId === objectiveId);
      }
      if (json) printJson({ files: result, rationales: result });
      else for (const row of result) console.log(JSON.stringify(row));
      return;
    }
    default:
      throw new CliError({ message: `Unknown command: ${command}` });
  }
}

/**
 * Why a launch command exited non-zero, in terms a user can act on.
 *
 * The bare "Launch command exited with status 1" said nothing about *what* ran:
 * the same message covered a missing agent binary, an inline spawn with no TTY,
 * and a terminal launcher that could not open. Name the resolved invocation and
 * the terminal it used (or the fact that there was none) so the mission event and
 * the runner service log both carry the cause.
 */
const MAX_RUNNER_FAILURE_MESSAGE_LENGTH = 1_200;

/** Keep launch diagnostics useful without letting env-bearing command text leak. */
export function sanitizeRunnerFailureMessage(value: unknown): string {
  const redacted = redactSecrets(value);
  return redacted.length <= MAX_RUNNER_FAILURE_MESSAGE_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_RUNNER_FAILURE_MESSAGE_LENGTH)}… [truncated]`;
}

export function launchFailureMessage({
  status,
  execution,
  terminal
}: {
  status: number | null;
  execution: { display: string; terminal: string | null };
  terminal: TerminalLaunchSettings;
}): string {
  const where = execution.terminal
    ? `in ${execution.terminal}${
        terminal.terminalLaunchPlacement ? ` (${terminal.terminalLaunchPlacement})` : ''
      }`
    : 'inline (no terminal launcher resolved for this device)';
  return sanitizeRunnerFailureMessage(
    `Launch command exited with status ${status ?? 'unknown'} running ${where}: ${execution.display}`
  );
}

/**
 * Whether a backend failure is the "this machine was never declared as an
 * execution target" refusal. The backend client folds the error code into the
 * rendered message as `(<code>)`, so match that marker rather than re-parsing
 * the response body.
 */
function isNoExecutionTargetRegisteredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('(no_execution_target_registered)');
}

/** The runner service cannot host an interactive agent inline without a TTY. */
export function shouldRefuseInlineRunnerLaunch({
  dryRun,
  terminalLauncher,
  executionProvider,
  stdoutIsTTY
}: {
  dryRun: boolean;
  terminalLauncher?: string | null;
  executionProvider?: string | null;
  stdoutIsTTY?: boolean;
}): boolean {
  return !dryRun && !terminalLauncher && executionProvider !== 'latch' && !stdoutIsTTY;
}

export async function runRunnerOnce({
  runtime,
  parsed,
  json
}: {
  runtime: CliRuntime;
  parsed: ReturnType<typeof parseArgs>;
  json: boolean;
}): Promise<{ launched: boolean; longPoll: boolean }> {
  let claim: unknown;
  try {
    claim = await runtime.backend.post<unknown>({
      path: '/api/runner/claim',
      body: {
        projectId: flagValue(parsed.flags, '--project-id'),
        ...clientDeviceIdentity(),
        // Contract v40: the claim poll doubles as this runner instance's
        // heartbeat, so local target liveness reflects a runner that can
        // actually take work rather than any CLI traffic from the machine.
        ...runnerRegistrationPayload()
      }
    });
  } catch (error) {
    // Contract v39: starting a runner never declares an execution target. A
    // machine nobody declared is unconfigured, not a new target, so say so and
    // stop instead of polling forever against work it can never claim.
    if (isNoExecutionTargetRegisteredError(error)) {
      throw new CliError({
        message: `${error instanceof Error ? error.message : String(error)}\nThe runner will not register a target for you — declare this machine first, then start it again.`
      });
    }
    throw error;
  }
  const request = asRecord(claim).request;
  const longPoll = asRecord(claim).longPoll === true;
  if (!request) return { launched: false, longPoll };
  const requestRecord = asRecord(request);
  const requestId = String(requestRecord.id);
  const projectId = String(requestRecord.projectId ?? '');
  const executionTargetId =
    typeof requestRecord.executionTargetId === 'string'
      ? requestRecord.executionTargetId.trim()
      : '';
  if (projectId && executionTargetId) {
    try {
      await reportRunnerResourceObservations({
        backend: runtime.backend,
        projectId,
        executionTargetId
      });
    } catch {
      // Observation writeback is best-effort; launch should still proceed.
    }
  }
  try {
    // This call must stay INSIDE the try: it is the claim-to-launch handoff, and a failure
    // here (transient network error, a 409 because the request was cleared under us, an
    // auth blip) used to escape before any reporting ran. The request then sat in `claimed`
    // with no `failed` event and no `last_error`, the claim query only ever reconsiders
    // `queued` rows, and an expired claim moves to the terminal `expired` status — so the
    // work was never retried and the UI kept rendering "Queued" forever with nothing
    // anywhere saying why. Reporting the failure returns the objective to a launchable
    // state on the first poll instead of stranding it until someone clears the queue.
    await runtime.backend.post({ path: `/api/runner/requests/${requestId}/launching` });
    const mutation = parseMutationFromMetadata(requestRecord.metadata);
    if (mutation) {
      const mutationResult = await executeLocalTargetMutation({ mutation });
      if (!mutationResult.ok) {
        await runtime.backend.post({
          path: `/api/runner/requests/${requestId}/failed`,
          body: { error: mutationResult.message }
        });
        throw new CliError({ message: mutationResult.message });
      }
      await runtime.backend.post({
        path: `/api/runner/requests/${requestId}/completed`,
        body: { mutationResult }
      });
      if (json) printJson({ request, mutationResult });
      else console.log(`Completed ${mutation.kind} for ${requestRecord.missionId}`);
      return { launched: true, longPoll };
    }

    // The execution request's agent is decided upstream from the objective row,
    // so a missing value is an invariant violation — never silently substitute a
    // default agent, which would launch work as the wrong tool. Fail the request
    // up front (the catch below reports it) so the cause surfaces instead of being
    // masked, and so no branch/terminal work is done for a request that can't run.
    const requestedAgent =
      typeof requestRecord.requestedAgent === 'string' ? requestRecord.requestedAgent.trim() : '';
    if (!requestedAgent) {
      throw new CliError({
        message: `Execution request ${requestId} has no agent; the objective must specify one before it can be launched.`
      });
    }
    const launchConfig = asRecord(requestRecord.launchConfig);
    // Launch settings are workspace-scoped: address the claimed request's own
    // workspace so a secondary-workspace run reads the same profile the user
    // configured, and so the read does not 400 (see `launch-settings.ts`).
    const requestWorkspaceId =
      typeof requestRecord.workspaceId === 'string' ? requestRecord.workspaceId : null;
    const terminal = await resolveTerminalLaunchSettings({
      runtime,
      flags: parsed.flags,
      workspaceId: requestWorkspaceId
    });
    const missionId = String(requestRecord.missionId);
    const dryRun = flagBoolean(parsed.flags, '--dry-run');
    const prepared = await prepareMissionBranch({
      runtime,
      options: {
        missionId,
        workingDirectory: String(requestRecord.workingDirectory ?? process.cwd()),
        objectiveId: String(requestRecord.objectiveId ?? ''),
        automationEnabled: await readWorktreeBranchAutomationEnabled(runtime),
        dryRun,
        overrideBranch: flagValue(parsed.flags, '--branch'),
        noWorktree: flagBoolean(parsed.flags, '--no-worktree')
      }
    });
    await recordBranchPrepared({
      runtime,
      missionId,
      requestId,
      branchAutomation: prepared.branchAutomation
    });
    const launchSession = launchSessionSnapshotFromMetadata(asRecord(requestRecord.metadata));
    // A runner must hand the agent a terminal of its own (a launcher window/tab,
    // or a Latch session). With neither, `launchAgent` spawns the agent inline on
    // the runner's own stdio: under the persistent runner service there is no TTY
    // at all, so an interactive agent exits immediately and the only trace is a
    // bare "Launch command exited with status 1". Refuse up front with the repair
    // instruction instead of producing that unexplained exit code.
    if (
      shouldRefuseInlineRunnerLaunch({
        dryRun,
        terminalLauncher: terminal.terminalLauncher,
        executionProvider: launchSession?.executionProvider.kind,
        stdoutIsTTY: process.stdout.isTTY
      })
    ) {
      throw new CliError({
        message:
          `Refusing to launch ${requestedAgent} inline: this runner has no TTY and no terminal ` +
          'launcher is configured for this device, so the agent would have nowhere to run. ' +
          'Set a terminal in Settings → Terminal & IDE (or run `ovld setup`), or select the ' +
          'Latch execution provider for this target, then re-run the objective.'
      });
    }
    const result = await launchAgent({
      runtime,
      options: {
        agent: requestedAgent,
        missionId,
        workingDirectory: prepared.workingDirectory,
        model:
          typeof requestRecord.requestedModel === 'string'
            ? requestRecord.requestedModel
            : undefined,
        thinking:
          typeof requestRecord.requestedReasoningEffort === 'string'
            ? requestRecord.requestedReasoningEffort
            : undefined,
        flags: normalizeAgentLaunchFlags(launchConfig.flags),
        preCommand:
          typeof launchConfig.preCommand === 'string' ? launchConfig.preCommand : undefined,
        preLaunchCommands: Array.isArray(requestRecord.preLaunchCommands)
          ? requestRecord.preLaunchCommands.filter(
              (value): value is string => typeof value === 'string'
            )
          : undefined,
        launchEnvVars: parseLaunchEnvVarsValue(requestRecord.launchEnvVars),
        executionRequestId: requestId,
        executionTargetId: executionTargetId || undefined,
        objectiveId:
          typeof requestRecord.objectiveId === 'string' ? requestRecord.objectiveId : undefined,
        launchSession,
        ...terminal,
        dryRun
      }
    });
    if (result.providerFallbackWarning) {
      console.error(`[overlord] ${result.providerFallbackWarning}`);
    }
    if (result.viewerOpen && result.viewerOpen.ok === false) {
      console.error(`[overlord] ${result.viewerOpen.warning}`);
    }
    if (result.status && result.status !== 0) {
      throw new CliError({
        message: launchFailureMessage({
          status: result.status,
          execution: result.plan.execution,
          terminal
        })
      });
    }
    await runtime.backend.post({
      path: `/api/runner/requests/${requestId}/launched`,
      body: result.providerSession ? { providerSession: result.providerSession } : {}
    });
    if (json || dryRun) {
      printJson({
        request,
        plan: result.plan,
        status: result.status,
        providerSession: result.providerSession ?? null,
        viewerOpen: result.viewerOpen ?? null,
        providerFallbackWarning: result.providerFallbackWarning ?? null
      });
    } else {
      console.log(`Launched ${requestedAgent} for ${requestRecord.missionId}`);
    }
    return { launched: true, longPoll };
  } catch (error) {
    // Best-effort: the report is how the backend learns this claim died, but a
    // failure to report must never replace the real error with "could not reach
    // the backend" or a 409 from a request that is already terminal — that is
    // what the supervisor writes to `runner-service.json` and shows the user.
    try {
      await runtime.backend.post({
        path: `/api/runner/requests/${requestId}/failed`,
        body: {
          error: sanitizeRunnerFailureMessage(error instanceof Error ? error.message : error)
        }
      });
    } catch {
      // Reporting failed too; surface the original cause below.
    }
    throw error;
  }
}

async function runRunnerCommand({
  runtime,
  parsed,
  json
}: {
  runtime: CliRuntime;
  parsed: ReturnType<typeof parseArgs>;
  json: boolean;
}): Promise<void> {
  const sub = parsed.positional[0] ?? 'status';
  if (sub === 'status') {
    const result = await runtime.backend.get<unknown>('/api/runner/status');
    if (json) printJson(result);
    else printJson(result);
    return;
  }
  if (sub === 'clear' || sub === 'clear-all') {
    // The queue is addressed by objective, so accept the display id users read
    // off a prompt (`coo:756.k7xm`) as readily as the positional UUID.
    const objectiveRef =
      sub === 'clear'
        ? (parsed.positional[1] ?? flagValue(parsed.flags, '--objective-id'))
        : undefined;
    const result = await runtime.backend.post({
      path: '/api/runner/clear',
      body: {
        objectiveId: objectiveRef,
        projectId: flagValue(parsed.flags, '--project-id')
      }
    });
    if (json) printJson(result);
    else console.log(`Cleared ${asRecord(result).cleared ?? 0} execution request(s).`);
    return;
  }
  if (sub === 'service') {
    await runRunnerServiceCommand({ parsed, json });
    return;
  }
  if (sub !== 'once' && sub !== 'start' && sub !== 'supervise') {
    throw new CliError({
      message:
        'Usage: ovld runner once|start|supervise|status|clear <objectiveId>|clear-all|service <install|start|stop|restart|status|uninstall>'
    });
  }

  const runOnce = () => runRunnerOnce({ runtime, parsed, json });

  if (sub === 'once') {
    const result = await runOnce();
    if (!result.launched) {
      if (json) printJson({ launched: false });
      else console.log('No claimable execution requests.');
    }
    return;
  }

  if (sub === 'supervise') {
    await runRunnerSupervisor({ runOnce, json });
    return;
  }

  const intervalMs = Number.parseInt(flagValue(parsed.flags, '--poll-interval-ms') ?? '3000', 10);
  if (!json) console.log(`Runner started. Polling every ${intervalMs}ms for execution requests.`);
  while (true) {
    let result = { launched: false, longPoll: false };
    try {
      result = await runOnce();
    } catch (error) {
      // One failed launch must not end the foreground runner. It used to throw
      // straight out of this loop, so the very first "Launch command exited with
      // status 1" left the machine with no runner at all — every later objective
      // then sat in the queue forever with nothing to claim it. `supervise`
      // already survived this; `start` now behaves the same.
      if (isNoExecutionTargetRegisteredError(error)) throw error;
      console.error(
        `[overlord] Runner poll failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    // A hosted claim either waited for work or advertises that the next claim
    // can do so. Reconnect directly; SQLite retains this foreground fallback.
    if (!result.longPoll) await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

/**
 * The persistent-runner supervisor loop behind `ovld runner supervise`. It owns
 * only the long-lived loop and fallback polling; each poll delegates to the same
 * one-shot claim-and-launch closure used by `ovld runner once`, so claim,
 * worktree, terminal, and launch behavior are never duplicated.
 */
async function runRunnerSupervisor({
  runOnce,
  json
}: {
  runOnce: () => Promise<{ launched: boolean; longPoll: boolean }>;
  json: boolean;
}): Promise<void> {
  if (!json) console.log('Runner supervisor started. Polling for execution requests.');
  const initialExecutableIdentity = captureRunnerSupervisorIdentity();
  for (;;) {
    if (
      shouldRestartRunnerSupervisor({
        initial: initialExecutableIdentity,
        current: captureRunnerSupervisorIdentity()
      })
    ) {
      // launchd KeepAlive and systemd Restart both respawn a clean exit. A
      // non-zero exit would be reported as a crash instead of an intentional
      // handoff to the newly installed program.
      console.error(
        'Runner supervisor executable was replaced or removed; exiting cleanly so the service manager restarts the installed build.'
      );
      process.exit(0);
    }
    const now = new Date();
    let result = { launched: false, longPoll: false };
    let lastError: string | null = null;
    try {
      result = await runOnce();
    } catch (error) {
      // An undeclared machine is a configuration error, not a transient poll
      // failure: retrying cannot fix it, so surface it and exit non-zero.
      if (isNoExecutionTargetRegisteredError(error)) throw error;
      lastError = error instanceof Error ? error.message : String(error);
      // The persistent service has no interactive terminal. Mirror the exact
      // diagnostic persisted below to stderr so launchd/systemd captures it in
      // the durable service error log as well.
      console.error(`[overlord] Runner poll failed: ${lastError}`);
    }
    const state = readRunnerServiceState();
    patchRunnerServiceState({
      lastHeartbeatAt: now.toISOString(),
      lastClaimedAt: result.launched ? now.toISOString() : state.lastClaimedAt,
      lastLaunchedAt: result.launched ? now.toISOString() : state.lastLaunchedAt,
      // Reflect the latest poll's outcome rather than falling back to the stored
      // value. A successful poll must clear a resolved failure (for example, an
      // auth error from before login) instead of leaving the desktop status box
      // stuck on "Runner error"; persistent failures recur on every poll.
      lastError,
      currentPollIntervalMs: FALLBACK_POLL_INTERVAL_MS
    });
    // Postgres holds idle claims for the bounded long-poll; sleeping here would
    // reintroduce the egress-heavy polling gap after every timeout/wake.
    if (!result.longPoll) {
      await new Promise(resolve => setTimeout(resolve, applyPollJitter(FALLBACK_POLL_INTERVAL_MS)));
    }
  }
}

/**
 * `ovld runner service <install|start|stop|restart|status|uninstall>` — manage
 * the OS-level persistent runner service. The desktop Settings panel and the
 * sidebar runner control invoke exactly these operations, so this is the single
 * owner of local service lifecycle.
 */
async function runRunnerServiceCommand({
  parsed,
  json
}: {
  parsed: ReturnType<typeof parseArgs>;
  json: boolean;
}): Promise<void> {
  const action = parsed.positional[1] ?? 'status';
  const manager = resolveServiceManager();
  if (!manager) {
    throw new CliError({
      message: `Persistent runner service is not supported on ${process.platform} yet. Use \`ovld runner start\` for a foreground runner.`
    });
  }

  if (action === 'status') {
    const runState = await manager.status();
    const state = readRunnerServiceState();
    const publisher =
      process.platform !== 'darwin' || !state.execProgram
        ? 'unknown'
        : state.execProgram.includes('.app/Contents/MacOS/')
          ? 'overlord'
          : 'node';
    const inspected =
      manager.kind === 'launchd' && runState.installed
        ? inspectInstalledLaunchdPlist(manager.unitPath())
        : null;
    const processType = inspected?.processType ?? null;
    const reinstallHint = runnerServiceReinstallHint({
      installed: runState.installed,
      publisher,
      processType,
      ...(inspected ? { path: inspected.path } : {})
    });
    const payload = {
      supported: true,
      kind: manager.kind,
      identifier: manager.identifier,
      unitPath: manager.unitPath(),
      installed: runState.installed,
      running: runState.running,
      backendUrl: state.backendUrl,
      installedAt: state.installedAt,
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastClaimedAt: state.lastClaimedAt,
      lastLaunchedAt: state.lastLaunchedAt,
      lastError: state.lastError,
      currentPollIntervalMs: state.currentPollIntervalMs,
      publisher,
      processType,
      path: inspected?.path ?? null,
      reinstallHint
    };
    if (json) printJson(payload);
    else {
      printKeyValue({
        Service: `${manager.kind} (${manager.identifier})`,
        Installed: runState.installed ? 'yes' : 'no',
        Running: runState.running,
        Publisher: publisher === 'unknown' ? '(unknown)' : publisher,
        ...(processType ? { 'Process type': processType } : {}),
        Backend: state.backendUrl ?? '(unknown)',
        'Last heartbeat': state.lastHeartbeatAt ?? '(never)',
        'Last launched': state.lastLaunchedAt ?? '(never)',
        'Poll interval': state.currentPollIntervalMs
          ? `${state.currentPollIntervalMs}ms`
          : '(idle)',
        'Last error': state.lastError ?? '(none)'
      });
      if (reinstallHint) console.log(`\nNote: ${reinstallHint}`);
    }
    return;
  }

  if (action === 'install') {
    const config = loadConfig();
    const backendUrl = resolveBackendUrl(config);
    const invocation = resolveOvldInvocation();
    const env = buildRunnerServiceEnv({
      backendUrl,
      runAsElectronNode: invocation.runAsElectronNode
    });
    const autoStart = !flagBoolean(parsed.flags, '--no-start');
    await manager.install({ invocation, env, autoStart });
    writeRunnerServiceState({
      ...readRunnerServiceState(),
      serviceKind: manager.kind,
      serviceIdentifier: manager.identifier,
      execProgram: invocation.program,
      execArgs: invocation.args,
      backendUrl,
      installedAt: new Date().toISOString(),
      lastError: null
    });
    const runState = await manager.status();
    if (json) printJson({ started: autoStart, ...runState });
    else
      console.log(
        `Persistent runner installed (${manager.kind}) and ${autoStart ? 'started' : 'not started'}.` +
          (manager.kind === 'launchd'
            ? ' Re-running install rewrites the LaunchAgent (ProcessType Interactive and PATH prefix); app auto-update respawns the process but does not rewrite the plist.'
            : '')
      );
    return;
  }

  if (action === 'start' || action === 'stop' || action === 'restart') {
    await manager[action]();
    const runState = await manager.status();
    if (json) printJson({ action, ...runState });
    else console.log(`Persistent runner ${action} complete (running: ${runState.running}).`);
    return;
  }

  if (action === 'uninstall') {
    await manager.uninstall();
    writeRunnerServiceState({
      ...readRunnerServiceState(),
      serviceKind: null,
      serviceIdentifier: null,
      installedAt: null
    });
    if (json) printJson({ uninstalled: true });
    else console.log('Persistent runner uninstalled.');
    return;
  }

  throw new CliError({
    message:
      'Usage: ovld runner service <install|start|stop|restart|status|uninstall> [--no-start] [--json]'
  });
}
