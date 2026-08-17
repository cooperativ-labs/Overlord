import { type AgentLaunchFlagDto, agentLaunchFlagsToArgv } from '@overlord/contract';
import {
  existingLatchProviderSession,
  formatObjectiveLatchDisplay,
  shouldUseLatchProvider
} from '@overlord/core/service/latch-launch';
import type { LaunchSessionSnapshot } from '@overlord/core/service/terminal-profile-types';
import { spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { writeChannelCredential } from './agent-session/channel.js';
import { resolveAgentBinary } from './agent-binaries.js';
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
import { ensureProjectTmpDir, pruneStaleProjectTmp } from './project-tmp.js';
import type { CliRuntime } from './runtime.js';
import {
  composeAgentTerminalCommand,
  type LaunchExecution,
  resolveLaunchExecution,
  terminalLaunchScriptContent,
  type TerminalLaunchSettings,
  tmpEnvFor
} from './terminal-launcher.js';

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
};

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
  launchSession?: LaunchSessionSnapshot | null;
  missionTitle?: string | null;
  missionDisplayId?: string | null;
  objectiveDisplayId?: string | null;
  objectiveTitle?: string | null;
};

export type LaunchAgentResult = {
  plan: LaunchPlan;
  status: number | null;
  signal: NodeJS.Signals | null;
  providerSession?: ExecutionProviderSession | null;
  viewerOpen?: LatchOpenResult | null;
  /** Non-fatal note when Latch was requested but unavailable — fell back to direct. */
  providerFallbackWarning?: string | null;
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

/**
 * Operational lifecycle event types excluded from the "Recent Activity" history
 * surfaced to the agent. The agent only cares
 * about substantive events (updates, deliveries, asks, alerts, discussion), not
 * runner/orchestration status churn.
 */
const AGENT_HISTORY_EXCLUDED_EVENT_TYPES = new Set([
  'status_change',
  'execution_requested',
  'awaiting_approval'
]);

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
  const events = await runtime.backend
    .get<unknown[]>(`/api/missions/${encodeURIComponent(missionId)}/events`)
    .catch(() => []);
  const artifacts = await runtime.backend
    .get<unknown[]>(`/api/missions/${encodeURIComponent(missionId)}/artifacts`)
    .catch(() => []);
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

  // Attachments are stored per objective and are not part of the mission detail
  // payload, so fetch them for each objective. Surfacing them in the launch
  // prompt is what lets the agent know files were attached to its objective
  // (otherwise it only ever sees them if it parses the raw attach JSON).
  const attachmentLines: string[] = [];
  await Promise.all(
    objectives.map(async objective => {
      const id = objective.id;
      if (typeof id !== 'string' || id.length === 0) return;
      const attachments = await runtime.backend
        .get<unknown[]>(`/api/objectives/${encodeURIComponent(id)}/attachments`)
        .catch(() => []);
      const label = objectiveDisplayRef(objective) ?? 'objective';
      for (const attachment of attachments) {
        const record = asRecord(attachment);
        const filename = String(record.filename ?? 'attachment');
        const contentType = record.contentType ? ` (${String(record.contentType)})` : '';
        attachmentLines.push(`- [${label}] ${filename}${contentType}`);
      }
    })
  );

  const attachCommand = objectiveDisplayId
    ? `ovld protocol attach --mission-id ${displayId} --objective-id ${objectiveDisplayId}`
    : `ovld protocol attach --mission-id ${displayId}`;

  const launchContext = [
    `# Overlord Mission: ${displayId}: ${title}`,
    '',
    `Mission ID: ${displayId}`,
    ...(objectiveDisplayId ? [`Objective ID: ${objectiveDisplayId}`] : []),
    '',
    '## Instructions',
    'Use the Overlord skill. Follow the required protocol workflow.',
    EXECUTION_DIRECTIVE,
    '',
    '## Objectives',
    ...objectives.map(objective => {
      const ref = objectiveDisplayRef(objective) ?? 'objective';
      return `- ${ref} [${objective.state ?? 'unknown'}] ${objectiveInstruction(objective)}`;
    }),
    '',
    ...(attachmentLines.length > 0
      ? [
          '## Attachments',
          'Files attached to the objective(s) below. Use `ovld protocol attachment-list` and `ovld protocol attachment-download-url` to retrieve them.',
          ...attachmentLines,
          ''
        ]
      : []),
    '## Recent Activity',
    ...events
      .filter(event => !AGENT_HISTORY_EXCLUDED_EVENT_TYPES.has(String(asRecord(event).type)))
      .slice(-20)
      .map(event => `- ${asRecord(event).summary ?? JSON.stringify(event)}`),
    '',
    '## Artifacts',
    ...artifacts.map(
      artifact => `- ${asRecord(artifact).label ?? asRecord(artifact).type ?? 'artifact'}`
    ),
    '',
    `Run \`${attachCommand}\` before making changes, update during work, and ALWAYS deliver last.`
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
  launchMessage
}: {
  agent: string;
  model?: string | null;
  thinking?: string | null;
  flags?: AgentLaunchFlagDto[];
  prompt: string;
  contextFile: string;
  launchMessage: string;
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
  pruneStaleProjectTmp({ workingDirectory: options.workingDirectory, create: true });
  const tmpDir = ensureProjectTmpDir(options.workingDirectory);
  const contextFileStem = context.objectiveDisplayId
    ? `objective-${context.objectiveDisplayId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    : `mission-${context.displayId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const contextFile = path.join(tmpDir, `${contextFileStem}.md`);
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
  // Stage the scoped credential before the agent starts, so it is on disk (owner-only, outside
  // every checkout) by the time the launched process first looks for it. A dry run stages
  // nothing: it must remain a pure description of what *would* happen.
  if (options.sessionChannelId && options.sessionChannelToken && !options.dryRun) {
    writeChannelCredential({
      channelId: options.sessionChannelId,
      token: options.sessionChannelToken
    });
  }

  const launchEnv = overlordLaunchEnv({
    backendUrl: runtime.backend.baseUrl,
    missionId: context.displayId,
    objectiveId: context.objectiveDisplayId,
    executionRequestId: options.executionRequestId,
    sessionChannelId: options.sessionChannelId,
    sessionChannelLaunchKind: options.sessionChannelLaunchKind,
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
    tmpDir
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
    ...launchEnv,
    ...resolvedEnvVars
  };

  const prompt =
    launchContext.length > 4000
      ? `Read the Overlord context file at ${contextFile}, attach to mission ${context.displayId}${context.objectiveDisplayId ? ` --objective-id ${context.objectiveDisplayId}` : ''}, then immediately execute its current objective. Do not wait for more instructions.`
      : launchContext;

  const command = buildAgentCommand({
    agent: options.agent,
    model: options.model,
    thinking: options.thinking,
    flags: options.flags,
    prompt,
    contextFile,
    launchMessage: `Attach to ovld mission ${context.displayId}${context.objectiveDisplayId ? ` objective ${context.objectiveDisplayId}` : ''}, then immediately execute ${context.objectiveTitle ?? context.title}. Do not wait for more instructions.`
  });

  const latchCommandString = composeAgentTerminalCommand({
    command: command.command,
    args: command.args,
    workingDirectory: options.workingDirectory,
    preCommand: options.preCommand,
    extraEnv: exportedEnv,
    preLaunchCommands
  });

  const terminalScriptPath = options.terminalLauncher?.trim()
    ? launchScriptPath({
        tmpDir,
        displayId: context.displayId,
        executionRequestId: options.executionRequestId
      })
    : null;
  if (terminalScriptPath) {
    writeFileSync(
      terminalScriptPath,
      terminalLaunchScriptContent({
        command: command.command,
        args: command.args,
        workingDirectory: options.workingDirectory,
        preCommand: options.preCommand,
        extraEnv: exportedEnv,
        preLaunchCommands
      })
    );
    chmodSync(terminalScriptPath, 0o700);
  }

  const execution = resolveLaunchExecution({
    command: command.command,
    args: command.args,
    workingDirectory: options.workingDirectory,
    preCommand: options.preCommand,
    terminalLauncher: options.terminalLauncher,
    terminalLaunchPlacement: options.terminalLaunchPlacement,
    terminalLaunchChord: options.terminalLaunchChord,
    terminalLaunchBackground: options.terminalLaunchBackground,
    terminalScriptPath,
    extraEnv: exportedEnv,
    preLaunchCommands
  });

  return {
    ...command,
    prompt,
    contextFile,
    workingDirectory: options.workingDirectory,
    execution,
    env: exportedEnv,
    latchCommandString,
    launchSession: options.launchSession ?? null,
    missionTitle: options.missionTitle ?? context.title,
    missionDisplayId: options.missionDisplayId ?? context.displayId,
    objectiveDisplayId: context.objectiveDisplayId,
    objectiveTitle: context.objectiveTitle
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

  const snapshot = options.launchSession ?? plan.launchSession ?? null;

  const providerKind = snapshot?.executionProvider.kind ?? 'direct';
  const executable = snapshot?.executionProvider.executable ?? 'latch';
  let providerFallbackWarning: string | null = null;
  let useLatch = false;
  let resolvedLatchExecutable = executable;
  // Captured from the discovery probe below so the viewer open can gate `--as`
  // on the CLI version without spawning a second `latch capabilities`.
  let latchProductVersion: string | null = null;
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
      providerFallbackWarning
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
    const latchDisplay = formatObjectiveLatchDisplay({
      objectiveDisplayId: plan.objectiveDisplayId ?? plan.missionDisplayId ?? options.missionId,
      objectiveTitle: plan.objectiveTitle ?? plan.missionTitle
    });
    const created = createLatchSession({
      executable: resolvedLatchExecutable,
      commandString: plan.latchCommandString,
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
      providerFallbackWarning
    };
  }

  const { execution } = plan;
  const result = execution.useShell
    ? spawnSync(execution.command, {
        cwd: options.workingDirectory,
        env,
        shell: true,
        stdio: 'inherit'
      })
    : spawnSync(execution.command, execution.args, {
        cwd: options.workingDirectory,
        env,
        stdio: 'inherit'
      });

  return {
    plan,
    status: result.status,
    signal: result.signal,
    providerSession: null,
    viewerOpen: null,
    providerFallbackWarning
  };
}
