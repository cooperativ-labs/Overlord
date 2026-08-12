import { type AgentLaunchFlagDto, agentLaunchFlagsToArgv } from '@overlord/contract';
import {
  existingLatchProviderSession,
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
};

function overlordLaunchEnv({
  backendUrl,
  missionId,
  executionRequestId,
  sessionChannelId,
  sessionChannelLaunchKind,
  projectResources
}: {
  backendUrl: string;
  missionId: string;
  executionRequestId?: string | null;
  sessionChannelId?: string | null;
  sessionChannelLaunchKind?: string | null;
  projectResources?: unknown[] | null;
}): Record<string, string> {
  return {
    MISSION_ID: missionId,
    OVERLORD_MISSION_ID: missionId,
    OVERLORD_BACKEND_URL: backendUrl,
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

async function loadMissionContext({
  runtime,
  missionId
}: {
  runtime: CliRuntime;
  missionId: string;
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
  const objectives = (
    Array.isArray(mission.objectives) ? mission.objectives.map(asRecord) : []
  ).filter(objective => objectiveInstruction(objective).length > 0);

  // Attachments are stored per objective and are not part of the mission detail
  // payload, so fetch them for each objective. Surfacing them in the launch
  // prompt is what lets the agent know files were attached to its objective
  // (otherwise it only ever sees them if it parses the raw attach JSON).
  const attachmentLines: string[] = [];
  await Promise.all(
    objectives.map(async (objective, index) => {
      const objectiveId = objective.id;
      if (typeof objectiveId !== 'string' || objectiveId.length === 0) return;
      const attachments = await runtime.backend
        .get<unknown[]>(`/api/objectives/${encodeURIComponent(objectiveId)}/attachments`)
        .catch(() => []);
      for (const attachment of attachments) {
        const record = asRecord(attachment);
        const filename = String(record.filename ?? 'attachment');
        const contentType = record.contentType ? ` (${String(record.contentType)})` : '';
        attachmentLines.push(`- [objective ${index + 1}] ${filename}${contentType}`);
      }
    })
  );

  const launchContext = [
    `# Overlord Mission: ${displayId}: ${title}`,
    '',
    // The mission id is the ONLY identifier an agent ever needs to type. State it
    // once, on its own line, in the exact form the attach command expects — a
    // prompt that only shows the id inside a heading (or that mentions any other
    // id at all) is what makes agents reach for the wrong value (coo:695).
    `Mission ID: ${displayId}`,
    '',
    '## Instructions',
    'Use the Overlord skill. Follow the required protocol workflow.',
    EXECUTION_DIRECTIVE,
    '',
    '## Objectives',
    ...objectives.map(
      (objective, index) =>
        `${index + 1}. [${objective.state ?? 'unknown'}] ${objectiveInstruction(objective)}`
    ),
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
    `Run \`ovld protocol attach --mission-id ${displayId}\` before making changes, update during work, and ALWAYS deliver last.`
  ].join('\n');

  return { displayId, title, launchContext };
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
  const context = await loadMissionContext({ runtime, missionId: options.missionId });
  pruneStaleProjectTmp({ workingDirectory: options.workingDirectory, create: true });
  const tmpDir = ensureProjectTmpDir(options.workingDirectory);
  const contextFile = path.join(
    tmpDir,
    `mission-${context.displayId.replace(/[^a-zA-Z0-9_-]/g, '-')}.md`
  );
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
      ? `Read the Overlord context file at ${contextFile}, attach to mission ${context.displayId}, then immediately execute its current objective. Do not wait for more instructions.`
      : launchContext;

  const command = buildAgentCommand({
    agent: options.agent,
    model: options.model,
    thinking: options.thinking,
    flags: options.flags,
    prompt,
    contextFile,
    launchMessage: `Attach to ovld mission ${context.displayId}, then immediately execute ${context.title}. Do not wait for more instructions.`
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
    missionDisplayId: options.missionDisplayId ?? context.displayId
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
    const result = spawnSync(shell, ['-lc', plan.latchCommandString], {
      cwd: options.workingDirectory,
      env,
      stdio: 'inherit'
    });
    return {
      plan: {
        ...plan,
        execution: {
          command: shell,
          args: ['-lc', plan.latchCommandString],
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
    const created = createLatchSession({
      executable: resolvedLatchExecutable,
      commandString: plan.latchCommandString,
      cwd: options.workingDirectory,
      env: plan.env,
      title: plan.missionTitle,
      name: plan.missionDisplayId,
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
        viewerKind: snapshot?.viewer.kind ?? 'iterm'
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
