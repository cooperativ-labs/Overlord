import { type AgentLaunchFlagDto, agentLaunchFlagsToArgv } from '@overlord/contract';
import {
  existingLatchProviderSession,
  formatObjectiveLatchDisplay,
  selectLatchAgentLaunch,
  shouldUseLatchProvider
} from '@overlord/core/service/latch-launch';
import type { LaunchSessionSnapshot } from '@overlord/core/service/terminal-profile-types';
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { writeChannelCredential } from './agent-session/channel.js';
import {
  attachArgs,
  type CodexAppServerPreflight,
  type CodexThreadLaunchSettings,
  codexThreadSettingsFromFlags,
  mintCodexLaunchChannel,
  ovldSelfInvocation,
  preflightCodexAppServer,
  resolveCodexBinary,
  startCodexSupervisorDetached,
  supervisorArgs,
  supervisorEnv
} from './agent-session/codex-app-server/launch.js';
import { resolveAgentBinary } from './agent-binaries.js';
import { partitionSecretEnv } from './argv-secrets.js';
import {
  claudeConfigDir,
  claudeDecisionHookAvailability,
  claudeDecisionHookSettings,
  claudeDecisionHookSkippedWarning
} from './claude-decision-hook.js';
import {
  checkCodexLaunchSelection,
  type CodexLiveModels,
  loadCodexLiveModels
} from './codex-models.js';
import { resolveHome } from './connectors.js';
import { CliError } from './errors.js';
import { discoverLatchOnThisDevice } from './latch-discovery.js';
import {
  createLatchSession,
  type ExecutionProviderSession,
  type LatchOpenResult,
  openLatchViewer
} from './latch-launch.js';
import {
  buildPreLaunchVariables,
  substituteLaunchEnvVars,
  substitutePreLaunchVariables
} from './pre-launch.js';
import {
  ensureHarnessScratchDir,
  ensureHarnessTmpDir,
  ensureProjectTmpDir,
  projectTmpSessionsDir,
  pruneStaleProjectTmp,
  sessionScratchName
} from './project-tmp.js';
import type { CliRuntime } from './runtime.js';
import {
  composeAgentTerminalCommand,
  type LaunchExecution,
  resolveLaunchExecution,
  TERMINAL_OPEN_SPAWN_KILL_SIGNAL,
  TERMINAL_OPEN_SPAWN_TIMEOUT_MS,
  terminalLaunchScriptContent,
  type TerminalLaunchSettings,
  terminalOpenSpawnTimeoutMs,
  tmpEnvFor
} from './terminal-launcher.js';
import { getCliVersion } from './version.js';

export type LaunchOptions = {
  agent: string;
  missionId: string;
  workingDirectory: string;
  model?: string | null;
  thinking?: string | null;
  flags?: AgentLaunchFlagDto[];
  preCommand?: string | null;
  /**
   * Per-project pre-launch command lines run inside the launch environment
   * after the terminal enters the working directory but before the agent
   * starts. `{VAR_NAME}` placeholders are substituted from the resolved launch
   * context at plan build time.
   */
  preLaunchCommands?: string[] | null;
  /**
   * Per-project user-defined environment variables exported into the launch
   * environment before the agent (and the pre-launch commands) run. `{VAR_NAME}`
   * placeholders in each value are substituted from the resolved launch context
   * at plan build time.
   */
  launchEnvVars?: Record<string, string> | null;
  executionRequestId?: string | null;
  executionTargetId?: string | null;
  /** UUID or display id of the objective this launch should pin to. */
  objectiveId?: string | null;
  /**
   * The session channel prepared for this launch. Only the **id** is exported into the launch
   * environment; the credential is staged in the owner-only global credential cache by
   * `writeChannelCredential` and never written into the launch script, because that script
   * lives in `<checkout>/.overlord/tmp` and a checkout-local secret is a secret you have
   * already lost. See `cli/src/agent-session/channel.ts`.
   */
  sessionChannelId?: string | null;
  sessionChannelToken?: string | null;
  sessionChannelLaunchKind?: string | null;
  /**
   * Open the agent in a new terminal window. A built-in name (`iTerm2`,
   * `Terminal`) or a raw prefix command (e.g. `open -a Ghostty --args`).
   * When omitted/null the agent runs inline in the current terminal.
   */
  terminalLauncher?: string | null;
  terminalLaunchPlacement?: TerminalLaunchSettings['terminalLaunchPlacement'];
  terminalLaunchChord?: string | null;
  terminalLaunchBackground?: boolean;
  dryRun?: boolean;
  /**
   * Claim-time provider/viewer snapshot. When absent the launch resolves to
   * direct (today's behavior). Never read live settings for a claimed request.
   */
  launchSession?: LaunchSessionSnapshot | null;
  /** Mission title for Latch display metadata. */
  missionTitle?: string | null;
  /** Mission display id used as the Latch session name hint. */
  missionDisplayId?: string | null;
  /**
   * How to drive the agent (ADR 0092). `appServer` runs a Codex objective through a private
   * Codex app server and the control-plane supervisor; anything else, or any other agent, is the
   * terminal launch observed through hooks.
   */
  harnessMode?: 'hooks' | 'appServer' | null;
  /** Test seam for the Codex install check. */
  codexPreflight?: () => CodexAppServerPreflight;
  /**
   * The live Codex model list a Codex launch's model and effort are checked against (test
   * seam). `null` means Codex could not be asked, and the launch is not checked.
   */
  codexLiveModels?: (args: { cwd: string }) => Promise<CodexLiveModels | null>;
};

/** Ask this machine's Codex (cached for a few minutes) for the models it supports. */
async function defaultCodexLiveModels({ cwd }: { cwd: string }): Promise<CodexLiveModels | null> {
  const codex = resolveCodexBinary();
  if (!codex) return null;
  return loadCodexLiveModels({ codexBin: codex.path, cwd, clientVersion: getCliVersion() });
}

/**
 * Refuse a Codex launch whose model or effort the installation does not support, before a
 * channel is minted or a terminal opens, so the person sees which models are available instead
 * of a Codex error in a terminal. Without a reachable Codex the launch goes ahead unchecked: the
 * bundled catalog is a guess, and refusing on a guess would block launches that would work.
 */
export async function assertCodexLaunchSelection(options: LaunchOptions): Promise<void> {
  if (options.agent !== 'codex' || options.dryRun) return;
  if (!options.model?.trim() && !options.thinking?.trim()) return;
  let live: CodexLiveModels | null = null;
  try {
    live = await (options.codexLiveModels ?? defaultCodexLiveModels)({
      cwd: options.workingDirectory
    });
  } catch {
    live = null;
  }
  if (!live) return;
  const check = checkCodexLaunchSelection({
    live,
    model: options.model,
    effort: options.thinking
  });
  if (!check.ok) throw new CliError({ message: check.message });
}

/** A launch that runs through the Codex app-server control plane. */
export type CodexControlPlanePlan = {
  adapter: 'codex-app-server';
  /** Null only in a dry run, which mints nothing. */
  channelId: string | null;
  supervisor: { program: string; args: string[] };
  logFile: string;
  /** Run before the supervisor starts, in place of the terminal's pre-launch lines. */
  preLaunchCommands: string[];
  threadSettings: CodexThreadLaunchSettings;
};

/**
 * Run a composed launch line in the same kind of shell environment as a new
 * terminal or Latch session. Pre-command wrappers are commonly shell functions
 * or binaries added by interactive startup files, so Node's default `/bin/sh`
 * cannot reliably resolve them.
 */
export function interactiveLoginShellInvocation(
  command: string,
  configuredShell = process.env.SHELL
): { command: string; args: string[] } {
  const shell = configuredShell?.trim() || '/bin/bash';
  return { command: shell, args: ['-ilc', command] };
}

/** `spawnSync` options for a direct launch. Timeout is set only for terminal-open. */
export function spawnSyncOptionsForLaunch({
  cwd,
  env,
  timeoutMs
}: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): SpawnSyncOptions {
  return {
    cwd,
    env,
    stdio: 'inherit',
    ...(timeoutMs === undefined
      ? {}
      : { timeout: timeoutMs, killSignal: TERMINAL_OPEN_SPAWN_KILL_SIGNAL })
  };
}

export function isSpawnSyncTimedOut(result: { error?: Error }): boolean {
  return (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
}

/**
 * Fail the execution request when osascript/Apple Event never returns, so the
 * supervisor can keep claiming. The terminal app may still open afterward.
 */
export function terminalOpenTimeoutMessage({
  terminal,
  timeoutMs
}: {
  terminal: string;
  timeoutMs: number;
}): string {
  const seconds = Math.round(timeoutMs / 1000);
  return (
    `osascript/Apple Event timed out after ${seconds}s while opening ${terminal}. ` +
    `The execution request failed so the runner can keep claiming. ` +
    `${terminal} may still open after this timeout (orphan window).`
  );
}

export function throwIfTerminalOpenTimedOut({
  result,
  execution
}: {
  result: Pick<SpawnSyncReturns<Buffer>, 'error'>;
  execution: LaunchExecution;
}): void {
  if (!execution.terminal || !isSpawnSyncTimedOut(result)) return;
  throw new Error(
    terminalOpenTimeoutMessage({
      terminal: execution.terminal,
      timeoutMs: TERMINAL_OPEN_SPAWN_TIMEOUT_MS
    })
  );
}

type LaunchPlan = {
  command: string;
  args: string[];
  prompt: string;
  contextFile: string;
  workingDirectory: string;
  execution: LaunchExecution;
  env: Record<string, string>;
  /** Present when this plan will (or did) use Latch create-then-open. */
  latchCommandString?: string | null;
  latchPreLaunchCommands?: string[];
  launchSession?: LaunchSessionSnapshot | null;
  missionTitle?: string | null;
  missionDisplayId?: string | null;
  objectiveDisplayId?: string | null;
  objectiveTitle?: string | null;
  /**
   * Set when a channel-bound Claude launch could not register the fail-closed decision hook,
   * so the session falls back to Claude's native permission prompts.
   */
  decisionHookWarning?: string | null;
  /** Set when the launch runs through the Codex app-server control plane (ADR 0092). */
  controlPlane?: CodexControlPlanePlan | null;
  /** Non-fatal notes about the harness mode: a fallback to hooks, or ignored settings. */
  harnessWarnings?: string[];
};

export type LaunchAgentResult = {
  plan: LaunchPlan;
  status: number | null;
  signal: NodeJS.Signals | null;
  providerSession?: ExecutionProviderSession | null;
  viewerOpen?: LatchOpenResult | null;
  /** Non-fatal note when Latch was requested but unavailable — fell back to direct. */
  providerFallbackWarning?: string | null;
  /** Pid of the detached control-plane supervisor, when the launch started one. */
  supervisorPid?: number | null;
};

type MissionContext = {
  displayId: string;
  title: string;
  launchContext: string;
  objectiveDisplayId: string | null;
  objectiveTitle: string | null;
};

function overlordLaunchEnv({
  backendUrl,
  missionId,
  objectiveId,
  executionRequestId,
  sessionChannelId,
  sessionChannelLaunchKind,
  projectResources
}: {
  backendUrl: string;
  missionId: string;
  objectiveId?: string | null;
  executionRequestId?: string | null;
  sessionChannelId?: string | null;
  sessionChannelLaunchKind?: string | null;
  projectResources?: unknown[] | null;
}): Record<string, string> {
  return {
    MISSION_ID: missionId,
    OVERLORD_MISSION_ID: missionId,
    OVERLORD_BACKEND_URL: backendUrl,
    ...(objectiveId ? { OVERLORD_OBJECTIVE_ID: objectiveId } : {}),
    ...(executionRequestId ? { OVERLORD_EXECUTION_REQUEST_ID: executionRequestId } : {}),
    // The id, never the token. Everything in this map may be written into the terminal launch
    // script under `<checkout>/.overlord/tmp`, so nothing secret may enter it.
    ...(sessionChannelId ? { OVERLORD_SESSION_CHANNEL_ID: sessionChannelId } : {}),
    ...(sessionChannelId
      ? { OVERLORD_SESSION_LAUNCH_KIND: sessionChannelLaunchKind || 'unknown' }
      : {}),
    ...(projectResources && projectResources.length > 0
      ? { OVERLORD_PROJECT_RESOURCES: JSON.stringify(projectResources) }
      : {})
  };
}

/**
 * Harness-specific launch environment.
 *
 * These are limits the harness already applies to itself. Pinning them makes the value this
 * run used a property of the launch rather than of whichever harness build happens to be
 * installed: Claude Code moved its subagent caps three times across 2.1.212–2.1.220, and a
 * fan-out that silently truncates mid-mission is indistinguishable, in the delivery report,
 * from an agent that chose to do less work.
 *
 * They are layered *under* the project's own `launchEnvVars`, so a project that wants a
 * different ceiling sets one and wins.
 */
function agentLaunchEnv(agent: string): Record<string, string> {
  if (agent === 'claude') {
    return {
      CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '20',
      CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: '200',
      CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '3'
    };
  }
  return {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Keep the execution intent visible even when context falls back to a file. */
const EXECUTION_DIRECTIVE =
  'This is an execution session. After attaching, immediately execute the current objective. Do not wait for more instructions or ask for confirmation; only stop to ask a question when blocked.';

/** Instruction text of an objective record, normalized across payload shapes. */
function objectiveInstruction(objective: Record<string, unknown>): string {
  const instruction = objective.instructionText ?? objective.instruction ?? '';
  return typeof instruction === 'string' ? instruction.trim() : '';
}

function objectiveDisplayRef(objective: Record<string, unknown>): string | null {
  const displayId = objective.displayId;
  return typeof displayId === 'string' && displayId.trim() ? displayId.trim() : null;
}

function objectiveTitleText(objective: Record<string, unknown>): string | null {
  const title = objective.title;
  if (typeof title === 'string' && title.trim()) return title.trim();
  const instruction = objectiveInstruction(objective);
  if (!instruction) return null;
  return instruction.length > 80 ? `${instruction.slice(0, 77).trimEnd()}…` : instruction;
}

/**
 * Next runnable draft (`nextUpDraft` in automations): the first draft with
 * instruction text by position, then id. Skips submitted and blank drafts.
 */
function nextRunnableDraft(
  objectives: Record<string, unknown>[]
): Record<string, unknown> | undefined {
  return [...objectives]
    .filter(objective => objective.state === 'draft' && objectiveInstruction(objective).trim())
    .sort(
      (a, b) =>
        Number(a.position ?? 0) - Number(b.position ?? 0) ||
        String(a.id ?? '').localeCompare(String(b.id ?? ''))
    )[0];
}

/** Match server `resolveActiveObjective` when the caller did not pin an objective. */
function pickLaunchObjective(
  objectives: Record<string, unknown>[],
  objectiveId?: string | null
): Record<string, unknown> | undefined {
  const pin = objectiveId?.trim();
  if (pin) {
    return objectives.find(
      objective =>
        objective.id === pin || objective.displayId === pin || objective.displayKey === pin
    );
  }
  return (
    objectives.find(objective => objective.state === 'executing') ??
    objectives.find(objective => objective.state === 'launching') ??
    objectives.find(objective => objective.state === 'pending_delivery') ??
    objectives.find(objective => objective.state === 'submitted') ??
    nextRunnableDraft(objectives) ??
    objectives.find(objective => objective.state === 'draft') ??
    objectives.find(objective => objective.state !== 'complete') ??
    objectives[0]
  );
}

async function loadMissionContext({
  runtime,
  missionId,
  objectiveId
}: {
  runtime: CliRuntime;
  missionId: string;
  objectiveId?: string | null;
}): Promise<MissionContext> {
  const mission = asRecord(
    await runtime.backend.get(`/api/missions/${encodeURIComponent(missionId)}`)
  );
  const displayId = String(mission.displayId ?? mission.id ?? missionId);
  const title = String(mission.title ?? '(untitled)');
  // Blank objectives are the empty slots the UI keeps ready for the user to type
  // the next objective into. They are not planned work, so they must never reach
  // the agent — an untyped slot reads as a real objective awaiting approval.
  const allObjectives = Array.isArray(mission.objectives) ? mission.objectives.map(asRecord) : [];
  const objectives = allObjectives.filter(objective => objectiveInstruction(objective).length > 0);
  const selected =
    pickLaunchObjective(allObjectives, objectiveId) ?? pickLaunchObjective(objectives);
  const objectiveDisplayId = selected ? objectiveDisplayRef(selected) : null;
  const selectedTitle = selected ? objectiveTitleText(selected) : null;

  const attachCommand = objectiveDisplayId
    ? `ovld protocol attach --mission-id ${displayId} --objective-id ${objectiveDisplayId}`
    : `ovld protocol attach --mission-id ${displayId}`;

  // The prompt only leads to attach (plan coo:1294, D3): attach returns the
  // objective, its siblings, attachments, history, artifacts and every working
  // and delivery rule, so repeating them here only spends context twice.
  const launchContext = [
    `# Overlord Mission: ${displayId}: ${title}`,
    '',
    `Mission ID: ${displayId}`,
    ...(objectiveDisplayId ? [`Objective ID: ${objectiveDisplayId}`] : []),
    '',
    '## Instructions',
    'Do not load the Overlord skill. The attach response carries all instructions for this session.',
    EXECUTION_DIRECTIVE,
    '',
    `Run \`${attachCommand}\` before making changes.`
  ].join('\n');

  return {
    displayId,
    title,
    launchContext,
    objectiveDisplayId,
    objectiveTitle: selectedTitle
  };
}

async function loadProjectResourcesForLaunch({
  runtime,
  missionId,
  executionTargetId
}: {
  runtime: CliRuntime;
  missionId: string;
  executionTargetId?: string | null;
}): Promise<unknown[] | null> {
  try {
    const context = await runtime.backend.post<unknown>({
      path: '/api/protocol/load-context',
      body: {
        flags: {
          '--mission-id': missionId,
          ...(executionTargetId ? { '--execution-target-id': executionTargetId } : {})
        }
      }
    });
    const record = asRecord(context);
    return Array.isArray(record.projectResources) ? record.projectResources : null;
  } catch {
    return null;
  }
}

function buildAgentCommand({
  agent,
  model,
  thinking,
  flags = [],
  prompt,
  contextFile,
  launchMessage,
  claudeSettings
}: {
  agent: string;
  model?: string | null;
  thinking?: string | null;
  flags?: AgentLaunchFlagDto[];
  prompt: string;
  contextFile: string;
  launchMessage: string;
  /** Extra `claude --settings` JSON (the per-launch decision hook); never holds a secret. */
  claudeSettings?: string | null;
}): { command: string; args: string[] } {
  const flagArgs = agentLaunchFlagsToArgv(flags);
  if (agent === 'codex') {
    const args = [];
    if (model) args.push('--model', model);
    if (thinking) args.push('-c', `model_reasoning_effort="${thinking}"`);
    args.push(...flagArgs, prompt);
    return { command: 'codex', args };
  }

  if (agent === 'claude') {
    const args = ['--append-system-prompt-file', contextFile];
    if (claudeSettings) args.push('--settings', claudeSettings);
    if (model) args.push('--model', model);
    if (thinking) args.push('--effort', thinking);
    args.push(...flagArgs, launchMessage);
    return { command: 'claude', args };
  }

  if (agent === 'pi') {
    const args = [];
    if (model) args.push('--model', model);
    if (thinking) args.push('--thinking', thinking);
    args.push(...flagArgs, `@${contextFile}`, launchMessage);
    return { command: 'pi', args };
  }

  const args = [];
  if (model) args.push('--model', model);
  args.push(...flagArgs, prompt);
  return { command: resolveAgentBinary(agent), args };
}

function safeLaunchScriptPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'launch';
}

function launchScriptPath({
  tmpDir,
  displayId,
  executionRequestId
}: {
  tmpDir: string;
  displayId: string;
  executionRequestId?: string | null;
}): string {
  const requestPart = executionRequestId
    ? safeLaunchScriptPart(executionRequestId)
    : `${process.pid}`;
  return path.join(tmpDir, `launch-${safeLaunchScriptPart(displayId)}-${requestPart}.sh`);
}

export async function buildLaunchPlan({
  runtime,
  options
}: {
  runtime: CliRuntime;
  options: LaunchOptions;
}): Promise<LaunchPlan> {
  const context = await loadMissionContext({
    runtime,
    missionId: options.missionId,
    objectiveId: options.objectiveId
  });
  await assertCodexLaunchSelection(options);
  pruneStaleProjectTmp({ workingDirectory: options.workingDirectory, create: true });
  const tmpDir = ensureProjectTmpDir(options.workingDirectory);
  ensureHarnessTmpDir(options.workingDirectory);
  const contextFileStem = context.objectiveDisplayId
    ? `objective-${context.objectiveDisplayId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    : `mission-${context.displayId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const contextFile = path.join(tmpDir, `${contextFileStem}.md`);
  // Each launch keeps its own TMPDIR for the lifetime of the harness,
  // including across delivery and explicit resumption.
  const sessionScratchDir = path.join(
    projectTmpSessionsDir(options.workingDirectory),
    sessionScratchName({
      missionDisplayId: context.displayId,
      objectiveDisplayId: context.objectiveDisplayId,
      executionRequestId: options.executionRequestId
    })
  );
  ensureHarnessScratchDir(options.workingDirectory, sessionScratchDir);
  // The execution request id is deliberately NOT written into the agent-facing
  // context. It is launch plumbing: it reaches the agent as the
  // `OVERLORD_EXECUTION_REQUEST_ID` env var, and `ovld protocol attach` picks it
  // up from there (or recovers it from the launch script) without the agent ever
  // naming it. Printing it beside "attach --mission-id" made it the only UUID in
  // the prompt, and agents passed it as the mission id (coo:695).
  const launchContext = context.launchContext;
  writeFileSync(contextFile, `${launchContext}\n`);
  const projectResources = await loadProjectResourcesForLaunch({
    runtime,
    missionId: options.missionId,
    executionTargetId: options.executionTargetId
  });
  // App-server mode (ADR 0092): a Codex objective runs through a private app server driven by
  // the control-plane supervisor, which needs a channel credential from the first turn. Any
  // failure here (Codex missing or too old, no objective, a backend without the route) falls
  // back to the terminal launch with a warning rather than failing the objective.
  const harnessWarnings: string[] = [];
  let sessionChannelId = options.sessionChannelId ?? null;
  let sessionChannelToken = options.sessionChannelToken ?? null;
  let sessionChannelLaunchKind = options.sessionChannelLaunchKind ?? null;
  let codexBin: string | null = null;
  let controlPlaneChannelId: string | null | undefined;
  if (options.agent === 'codex' && options.harnessMode === 'appServer') {
    const preflight = (options.codexPreflight ?? preflightCodexAppServer)();
    if (!preflight.ok) {
      harnessWarnings.push(preflight.warning);
    } else if (!context.objectiveDisplayId) {
      harnessWarnings.push(
        'Codex app-server mode needs an objective to bind the session to; launching in the ' +
          'terminal (hooks) instead.'
      );
    } else if (options.dryRun) {
      codexBin = preflight.codex.path;
      controlPlaneChannelId = null;
    } else {
      try {
        const minted = await mintCodexLaunchChannel({
          backend: runtime.backend,
          objectiveRef: context.objectiveDisplayId,
          adapterVersion: getCliVersion(),
          executionRequestId: options.executionRequestId,
          executionTargetId: options.executionTargetId
        });
        codexBin = preflight.codex.path;
        controlPlaneChannelId = minted.channelId;
        sessionChannelId = minted.channelId;
        sessionChannelToken = minted.token;
        sessionChannelLaunchKind = 'control_plane';
      } catch (error) {
        harnessWarnings.push(
          `Could not mint the session channel for Codex app-server mode (${
            error instanceof Error ? error.message : String(error)
          }); launching in the terminal (hooks) instead.`
        );
      }
    }
  }
  const useControlPlane = controlPlaneChannelId !== undefined;

  // Stage the scoped credential before the agent starts, so it is on disk (owner-only, outside
  // every checkout) by the time the launched process first looks for it. A dry run stages
  // nothing: it must remain a pure description of what *would* happen.
  if (sessionChannelId && sessionChannelToken && !options.dryRun) {
    writeChannelCredential({ channelId: sessionChannelId, token: sessionChannelToken });
  }

  const launchEnv = overlordLaunchEnv({
    backendUrl: runtime.backend.baseUrl,
    missionId: context.displayId,
    objectiveId: context.objectiveDisplayId,
    executionRequestId: options.executionRequestId,
    sessionChannelId,
    sessionChannelLaunchKind,
    projectResources
  });

  // The `{VAR_NAME}` substitution map is derived from Overlord's own launch env
  // plus convenience variables — not from user-defined env vars — so `{VAR}`
  // always means launch context and user vars are referenced with shell `$VAR`.
  // See `LAUNCH_VARIABLES` in `@overlord/contract` for the documented catalog.
  const launchVariables = buildPreLaunchVariables({
    launchEnv,
    projectResources,
    workingDirectory: options.workingDirectory,
    contextFile,
    tmpDir: sessionScratchDir
  });

  // Resolve `{VAR_NAME}` placeholders in the project's pre-launch commands
  // against the launch context so the runner/terminal runs literal, ready-to-go
  // command lines.
  const preLaunchCommands =
    options.preLaunchCommands && options.preLaunchCommands.length > 0
      ? substitutePreLaunchVariables(options.preLaunchCommands, launchVariables)
      : [];

  // Resolve `{VAR_NAME}` placeholders in the project's user-defined env vars and
  // layer them onto Overlord's launch env so they are exported before both the
  // pre-launch commands and the agent (e.g. `AGENT_POD_EXTRA_ALLOWED_PATHS`).
  const resolvedEnvVars =
    options.launchEnvVars && Object.keys(options.launchEnvVars).length > 0
      ? substituteLaunchEnvVars(options.launchEnvVars, launchVariables)
      : {};
  const exportedEnv = {
    ...agentLaunchEnv(options.agent),
    ...tmpEnvFor(options.workingDirectory, sessionScratchDir),
    ...launchEnv,
    ...resolvedEnvVars
  };

  const prompt =
    launchContext.length > 4000
      ? `Read the Overlord context file at ${contextFile}, attach to mission ${context.displayId}${context.objectiveDisplayId ? ` --objective-id ${context.objectiveDisplayId}` : ''}, then immediately execute its current objective. Do not wait for more instructions.`
      : launchContext;

  // The fail-closed decision hook is registered only for sessions launched with a session
  // channel (the only sessions with a remote decision path), and only when the hooks server it
  // calls is installed. Otherwise the session keeps Claude's native prompts.
  let claudeSettings: string | null = null;
  let decisionHookWarning: string | null = null;
  if (options.agent === 'claude' && options.sessionChannelId) {
    const availability = claudeDecisionHookAvailability({
      configDir: claudeConfigDir({ env: { ...process.env, ...exportedEnv } }),
      ovldHome: resolveHome()
    });
    if (availability.available) {
      claudeSettings = JSON.stringify(claudeDecisionHookSettings());
    } else {
      decisionHookWarning = claudeDecisionHookSkippedWarning(availability.reason);
    }
  }

  let controlPlane: CodexControlPlanePlan | null = null;
  let terminalPreCommand = options.preCommand;
  let terminalPreLaunchCommands = preLaunchCommands;
  let command: { command: string; args: string[] };
  if (useControlPlane) {
    // The supervisor sends the objective prompt as the thread's first turn; the visible terminal
    // only attaches the Codex TUI to that thread. Launch flags become thread settings.
    const threadSettings = codexThreadSettingsFromFlags(options.flags ?? []);
    if (threadSettings.ignored.length > 0) {
      harnessWarnings.push(
        `Codex app-server mode ignores these launch flags: ${threadSettings.ignored.join(', ')}.`
      );
    }
    if (options.preCommand?.trim()) {
      harnessWarnings.push(
        `Codex app-server mode ignores the pre-command \`${options.preCommand.trim()}\`: the app ` +
          'server is started by Overlord, not by the terminal.'
      );
    }
    const self = ovldSelfInvocation();
    controlPlane = {
      adapter: 'codex-app-server',
      channelId: controlPlaneChannelId ?? null,
      supervisor: {
        program: self.program,
        args: [
          ...self.args,
          ...supervisorArgs({
            contextFile,
            workingDirectory: options.workingDirectory,
            model: options.model,
            effort: options.thinking,
            settings: threadSettings,
            codexBin
          })
        ]
      },
      logFile: path.join(sessionScratchDir, 'codex-app-server.log'),
      preLaunchCommands,
      threadSettings
    };
    const attach = [...self.args, ...attachArgs(controlPlaneChannelId ?? '<minted-at-launch>')];
    // Under the desktop app, `ovld` runs as Electron-as-Node; a fresh terminal must say so too.
    command = process.env.ELECTRON_RUN_AS_NODE
      ? { command: 'env', args: ['ELECTRON_RUN_AS_NODE=1', self.program, ...attach] }
      : { command: self.program, args: attach };
    terminalPreCommand = null;
    terminalPreLaunchCommands = [];
  } else {
    command = buildAgentCommand({
      agent: options.agent,
      model: options.model,
      thinking: options.thinking,
      flags: options.flags,
      prompt,
      contextFile,
      claudeSettings,
      launchMessage: `Attach to ovld mission ${context.displayId}${context.objectiveDisplayId ? ` objective ${context.objectiveDisplayId}` : ''}, then immediately execute ${context.objectiveTitle ?? context.title}. Do not wait for more instructions.`
    });
  }

  // The Latch command string becomes argv (`$SHELL -ilc S`, inline or inside Latch), which any
  // local user can read. Secret-looking values (a project `launchEnvVars` token, say) are left
  // out of its exports and reach the agent only through the process environment: the inline
  // spawn passes `plan.env`, and the Latch manifest carries it as `launch.env`.
  const latchCommandString = composeAgentTerminalCommand({
    command: command.command,
    args: command.args,
    workingDirectory: options.workingDirectory,
    preCommand: terminalPreCommand,
    extraEnv: partitionSecretEnv(exportedEnv).argvSafe,
    preLaunchCommands: terminalPreLaunchCommands
  });

  const terminalScriptPath = options.terminalLauncher?.trim()
    ? launchScriptPath({
        tmpDir,
        displayId: context.displayId,
        executionRequestId: options.executionRequestId
      })
    : null;
  if (terminalScriptPath) {
    // A new terminal window inherits no environment, so this script must export the full
    // launch env. Create it owner-only rather than chmod'ing a world-readable file afterwards;
    // the chmod still covers a script left behind by an earlier launch.
    writeFileSync(
      terminalScriptPath,
      terminalLaunchScriptContent({
        command: command.command,
        args: command.args,
        workingDirectory: options.workingDirectory,
        preCommand: terminalPreCommand,
        extraEnv: exportedEnv,
        preLaunchCommands: terminalPreLaunchCommands
      }),
      { mode: 0o700 }
    );
    chmodSync(terminalScriptPath, 0o700);
  }

  const execution = resolveLaunchExecution({
    command: command.command,
    args: command.args,
    workingDirectory: options.workingDirectory,
    preCommand: terminalPreCommand,
    terminalLauncher: options.terminalLauncher,
    terminalLaunchPlacement: options.terminalLaunchPlacement,
    terminalLaunchChord: options.terminalLaunchChord,
    terminalLaunchBackground: options.terminalLaunchBackground,
    terminalScriptPath,
    extraEnv: exportedEnv,
    preLaunchCommands: terminalPreLaunchCommands
  });

  return {
    ...command,
    prompt,
    contextFile,
    workingDirectory: options.workingDirectory,
    execution,
    env: exportedEnv,
    latchCommandString,
    latchPreLaunchCommands: terminalPreLaunchCommands,
    launchSession: options.launchSession ?? null,
    missionTitle: options.missionTitle ?? context.title,
    missionDisplayId: options.missionDisplayId ?? context.displayId,
    objectiveDisplayId: context.objectiveDisplayId,
    objectiveTitle: context.objectiveTitle,
    decisionHookWarning,
    controlPlane,
    harnessWarnings
  };
}

export async function launchAgent({
  runtime,
  options
}: {
  runtime: CliRuntime;
  options: LaunchOptions;
}): Promise<LaunchAgentResult> {
  const plan = await buildLaunchPlan({ runtime, options });
  if (options.dryRun) {
    return { plan, status: 0, signal: null };
  }

  const env = {
    ...process.env,
    ...tmpEnvFor(options.workingDirectory),
    ...plan.env
  };

  // App-server mode: the supervisor owns the session, so it starts first and detached; whatever
  // terminal opens below only attaches the Codex TUI to the thread it drives.
  let supervisorPid: number | null = null;
  if (plan.controlPlane) {
    supervisorPid = startCodexSupervisorDetached({
      program: plan.controlPlane.supervisor.program,
      args: plan.controlPlane.supervisor.args,
      cwd: options.workingDirectory,
      env: supervisorEnv(env),
      logFile: plan.controlPlane.logFile,
      preLaunchCommands: plan.controlPlane.preLaunchCommands
    }).pid;
  }

  const snapshot = options.launchSession ?? plan.launchSession ?? null;

  const providerKind = snapshot?.executionProvider.kind ?? 'direct';
  const executable = snapshot?.executionProvider.executable ?? 'latch';
  let providerFallbackWarning: string | null = null;
  let useLatch = false;
  let resolvedLatchExecutable = executable;
  // Captured from the discovery probe below so the viewer open can gate `--as`
  // on the CLI version without spawning a second `latch capabilities`.
  let latchProductVersion: string | null = null;
  let latchExtensions: string[] = [];
  // This inherited marker correlates the launch with an already-running Latch
  // PTY; it is not consulted for any Overlord authorization decision.
  const existingProviderSession =
    providerKind === 'latch'
      ? existingLatchProviderSession({
          latchSessionId: process.env.LATCH_SESSION_ID,
          executionTargetId: options.executionTargetId
        })
      : null;

  if (existingProviderSession && plan.latchCommandString) {
    const shell = process.env.SHELL?.trim() || '/bin/bash';
    // Latch refuses nested `create` calls. Run the exact command string that
    // would have gone in the manifest inline in the current Latch-owned PTY.
    // No timeout: this is the long-running agent process, not a terminal-open.
    const result = spawnSync(shell, ['-ilc', plan.latchCommandString], {
      cwd: options.workingDirectory,
      env,
      stdio: 'inherit'
    });
    return {
      plan: {
        ...plan,
        execution: {
          command: shell,
          args: ['-ilc', plan.latchCommandString],
          useShell: false,
          terminal: null,
          display: `Latch session ${existingProviderSession.providerSessionId} (inline) › ${plan.latchCommandString}`
        }
      },
      status: result.status,
      signal: result.signal,
      providerSession: existingProviderSession,
      viewerOpen: null,
      providerFallbackWarning,
      supervisorPid
    };
  }

  if (providerKind === 'latch') {
    if (!options.executionTargetId) {
      providerFallbackWarning =
        'Latch provider selected but no execution target id is available; falling back to direct launch.';
    } else {
      const discovery = discoverLatchOnThisDevice({
        executionTargetId: options.executionTargetId,
        executable
      });
      useLatch = shouldUseLatchProvider({
        providerKind,
        latchSelectable: discovery.latchSelectable
      });
      if (useLatch && discovery.state === 'found') {
        // Discovery may have found Latch in its documented install directory
        // after a macOS GUI/service PATH omitted it. Use that exact executable
        // for create/open too, rather than resolving the bare name again.
        resolvedLatchExecutable = discovery.resolvedPath;
        latchProductVersion = discovery.productVersion;
        latchExtensions = discovery.capabilities.extensions;
      }
      if (!useLatch) {
        providerFallbackWarning =
          discovery.state === 'not_installed'
            ? `Latch is not installed on this execution target (${discovery.installCommand}); falling back to direct launch.`
            : discovery.state === 'incompatible'
              ? `Latch is incompatible (${discovery.missingCapability}: ${discovery.detail}); falling back to direct launch.`
              : 'Latch is unavailable; falling back to direct launch.';
      }
    }
  }

  if (useLatch && plan.latchCommandString) {
    const shell = process.env.SHELL?.trim() || '/bin/bash';
    const agentLaunch = selectLatchAgentLaunch({
      agent: options.agent,
      argv: [plan.command, ...plan.args],
      preCommand: options.preCommand,
      preLaunchCommands: plan.latchPreLaunchCommands,
      extensions: latchExtensions,
      shell
    });
    const latchDisplay = formatObjectiveLatchDisplay({
      objectiveDisplayId: plan.objectiveDisplayId ?? plan.missionDisplayId ?? options.missionId,
      objectiveTitle: plan.objectiveTitle ?? plan.missionTitle
    });
    const created = createLatchSession({
      executable: resolvedLatchExecutable,
      commandString: plan.latchCommandString,
      agentLaunch,
      shell,
      cwd: options.workingDirectory,
      env: plan.env,
      title: latchDisplay.title,
      name: latchDisplay.name,
      commandLabel: options.agent,
      externalRunId: options.executionRequestId,
      executionTargetId: options.executionTargetId
    });

    let viewerOpen: LatchOpenResult | null = null;
    const openOnLaunch = snapshot?.viewer.openOnLaunch !== false;
    if (openOnLaunch) {
      viewerOpen = openLatchViewer({
        executable: resolvedLatchExecutable,
        providerSessionId: created.providerSession.providerSessionId,
        viewerKind: snapshot?.viewer.kind ?? 'iterm',
        openAs: snapshot?.viewer.openAs ?? null,
        // Falls back to the resolved profile for a request claimed before the
        // snapshot carried `background`.
        background: snapshot?.viewer.background ?? options.terminalLaunchBackground ?? false,
        productVersion: latchProductVersion
      });
    }

    return {
      plan: {
        ...plan,
        execution: {
          command: resolvedLatchExecutable,
          args: ['create', '--manifest-file', '-', '--json'],
          useShell: false,
          terminal: snapshot?.viewer.launcher ?? null,
          display: `latch create › ${plan.latchCommandString}`
        }
      },
      status: 0,
      signal: null,
      providerSession: created.providerSession,
      viewerOpen,
      providerFallbackWarning,
      supervisorPid
    };
  }

  const { execution } = plan;
  // A runner with no terminal and no Latch has nowhere to show the TUI. In app-server mode that
  // is fine: the session runs in the supervisor, and a person can attach later with
  // `ovld agent-session attach`.
  if (plan.controlPlane && !execution.terminal && !process.stdout.isTTY) {
    return {
      plan,
      status: 0,
      signal: null,
      providerSession: null,
      viewerOpen: null,
      providerFallbackWarning,
      supervisorPid
    };
  }
  const timeoutMs = terminalOpenSpawnTimeoutMs(execution);
  const spawnOptions = spawnSyncOptionsForLaunch({
    cwd: options.workingDirectory,
    env,
    timeoutMs
  });
  const shellInvocation = execution.useShell
    ? interactiveLoginShellInvocation(execution.command)
    : null;
  const result = shellInvocation
    ? spawnSync(shellInvocation.command, shellInvocation.args, spawnOptions)
    : spawnSync(execution.command, execution.args, spawnOptions);
  throwIfTerminalOpenTimedOut({ result, execution });

  return {
    plan,
    status: result.status,
    signal: result.signal,
    providerSession: null,
    viewerOpen: null,
    providerFallbackWarning,
    supervisorPid
  };
}
