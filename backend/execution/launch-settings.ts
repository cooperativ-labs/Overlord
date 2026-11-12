/** Per-user launch settings and project launch preferences. */
import { type Permission, PERMISSIONS } from '@overlord/auth';
import type {
  AgentLaunchConfigDto,
  LaunchPreferenceDto,
  LaunchSessionDefaultsDto,
  LaunchSettingsDto,
  TerminalProfileDto,
  UpdateAgentLaunchConfigBody,
  UpdateLaunchPreferenceBody,
  UpdateLaunchSessionDefaultsBody,
  UpdateTerminalProfileBody,
  UpdateWorktreeBranchAutomationBody
} from '@overlord/contract';
import { normalizeAgentLaunchFlags } from '@overlord/contract';
import type { ServiceContext } from '@overlord/core/service/context';
import {
  DEFAULT_LAUNCH_SESSION_DEFAULTS,
  DEFAULT_TERMINAL_PROFILE,
  type LaunchSessionDefaults,
  normalizeExecutionProvider,
  resolveLaunchSession,
  type TerminalLaunchPlacement,
  type TerminalProfile
} from '@overlord/core/service/terminal-profile-types';
import { type DatabaseClient } from '@overlord/database';

import {
  findActingDeviceTarget,
  type LocalExecutionTarget,
  readActorLaunchSessionDefaults,
  requireActingDeviceTarget,
  updateActorLaunchSessionDefaults,
  updateTerminalProfile as persistTerminalProfile
} from '../../packages/core/service/execution-targets.ts';
import {
  parseAgentConfigs,
  readProjectUserPreferenceRow
} from '../../packages/core/service/project-execution-target.ts';
import {
  buildWebappServiceContextForWorkspace,
  getImplicitWorkspaceIdOrNull,
  newId,
  nowIso,
  requireDatabaseClient
} from '../db.ts';
import { ApiError } from '../errors.ts';
import { requireProjectPermission, requireWorkspacePermission } from '../rbac.ts';

async function launchSettingsDto({
  target,
  ctx,
  agentConfigs = target?.agentConfigs ?? {},
  terminalProfile = target?.terminalProfile ?? toTerminalProfileDto(DEFAULT_TERMINAL_PROFILE),
  launchSessionDefaults
}: {
  /** `null` when the acting machine has no declared execution target (contract v38). */
  target: LocalLaunchTarget | null;
  ctx: ServiceContext;
  agentConfigs?: Record<string, AgentLaunchConfigDto>;
  terminalProfile?: TerminalProfileDto;
  launchSessionDefaults?: LaunchSessionDefaults;
}): Promise<LaunchSettingsDto> {
  const defaults = launchSessionDefaults ?? (await readActorLaunchSessionDefaults({ ctx }));
  return {
    executionTargetId: target?.executionTargetId ?? null,
    deviceLabel: target?.deviceLabel ?? null,
    agentConfigs,
    terminalProfile,
    launchSessionDefaults: toLaunchSessionDefaultsDto(defaults),
    // Resolved from the same stored profile the DTO carries, so a client never has
    // to re-implement the target-override-then-user-default precedence itself.
    resolvedLaunchSession: target
      ? resolveLaunchSession({ profile: fromTerminalProfileDto(terminalProfile), defaults })
      : null,
    worktreeBranchAutomationEnabled: defaults.worktreeBranchAutomationEnabled
  };
}

/**
 * Resolve the `(workspace, ServiceContext)` a launch-settings operation targets.
 * An explicit `workspaceId` is authorized against the caller's *own* membership
 * in that workspace (coo:135 pattern — 404 for non-members) and yields a context
 * bound to it, so a secondary-workspace mission's launch config is read/written
 * in **its** workspace — matching where `launchObjective` resolves it. Omitted →
 * the request's active workspace (back-compat), whose route-level permission gate
 * has already run. Mirrors `resolveCatalogWorkspaceId`, but also carries the
 * membership-bound context (§2.1) needed to provision the acting-device target.
 */
async function resolveLaunchSettingsScope(
  workspaceId: string | undefined,
  permission: Permission,
  client: DatabaseClient
): Promise<{ workspaceId: string; ctx: ServiceContext }> {
  if (!workspaceId) {
    const fallback = getImplicitWorkspaceIdOrNull();
    if (!fallback) throw new ApiError(400, 'workspaceId is required');
    const ctx = await buildWebappServiceContextForWorkspace(fallback, client);
    return { workspaceId: fallback, ctx };
  }
  const membershipId = await requireWorkspacePermission({
    workspaceId,
    permission,
    db: client,
    notFoundMessage: 'Workspace not found or no active membership'
  });
  const ctx = await buildWebappServiceContextForWorkspace(workspaceId, client, membershipId);
  return { workspaceId, ctx };
}

// ---- Local device / execution target provisioning -------------------------

function toTerminalProfileDto(profile: TerminalProfile): TerminalProfileDto {
  return {
    launcher: profile.launcher ?? null,
    placement: profile.placement ?? 'window',
    chord: profile.chord ?? null,
    background: profile.background ?? false,
    // `null` (not omitted) so a client can tell "inherits the user default" from
    // "this field predates the provider setting" — both read as direct today.
    executionProvider: profile.executionProvider ?? null,
    openViewerOnLaunch: profile.openViewerOnLaunch ?? null
  };
}

/** DTO → stored profile. Absent provider/viewer fields stay absent (inherit). */
function fromTerminalProfileDto(dto: TerminalProfileDto): TerminalProfile {
  return {
    launcher: dto.launcher ?? null,
    // A stored placement is read back as written (schema-disagreements.md L4).
    placement: (dto.placement ?? 'window') as TerminalLaunchPlacement,
    chord: dto.chord ?? null,
    background: dto.background ?? false,
    ...(dto.executionProvider ? { executionProvider: dto.executionProvider } : {}),
    ...(typeof dto.openViewerOnLaunch === 'boolean'
      ? { openViewerOnLaunch: dto.openViewerOnLaunch }
      : {})
  };
}

/**
 * Map an inbound terminal-profile body onto the stored profile. The provider and
 * viewer-on-launch fields are tri-state: omitted keeps the stored override, `null`
 * clears it back to inheriting the user default, and a value sets the override.
 * The terminal choice itself (`launcher`) is untouched by either, which is what
 * makes toggling the provider lossless.
 */
function terminalProfileFromBody(
  body: UpdateTerminalProfileBody,
  current: TerminalProfile
): TerminalProfile {
  const profile: TerminalProfile = {
    launcher: body.launcher ?? null,
    placement: body.placement ?? 'window',
    chord: body.placement === 'chord' ? (body.chord ?? null) : null,
    background: body.background ?? false
  };

  const provider =
    body.executionProvider === undefined
      ? current.executionProvider
      : body.executionProvider === null
        ? undefined
        : (normalizeExecutionProvider(body.executionProvider) ?? undefined);
  if (provider) profile.executionProvider = provider;

  const openViewer =
    body.openViewerOnLaunch === undefined
      ? current.openViewerOnLaunch
      : body.openViewerOnLaunch === null
        ? undefined
        : body.openViewerOnLaunch;
  if (typeof openViewer === 'boolean') profile.openViewerOnLaunch = openViewer;

  return profile;
}

function toLaunchSessionDefaultsDto(defaults: LaunchSessionDefaults): LaunchSessionDefaultsDto {
  return {
    executionProvider: { ...defaults.executionProvider },
    openViewerOnLaunch: defaults.openViewerOnLaunch,
    worktreeBranchAutomationEnabled: defaults.worktreeBranchAutomationEnabled
  };
}

async function readAgentConfigs(
  preferenceId: string | null,
  client: DatabaseClient = requireDatabaseClient()
): Promise<Record<string, AgentLaunchConfigDto>> {
  if (!preferenceId) return {};
  const row = await client.get<{ agent_configs_json: string }>(
    `SELECT agent_configs_json FROM user_execution_target_preferences WHERE id = ?`,
    [preferenceId]
  );
  return row ? parseAgentConfigs(row.agent_configs_json) : {};
}

type LocalLaunchTarget = {
  deviceId: string;
  deviceLabel: string;
  executionTargetId: string;
  userTargetId: string | null;
  preferenceId: string | null;
  agentConfigs: Record<string, AgentLaunchConfigDto>;
  terminalProfile: TerminalProfileDto;
};

async function toLocalLaunchTarget(
  target: LocalExecutionTarget,
  client: DatabaseClient
): Promise<LocalLaunchTarget> {
  return {
    deviceId: target.deviceId,
    deviceLabel: target.deviceLabel,
    executionTargetId: target.executionTargetId,
    userTargetId: target.userTargetId,
    preferenceId: target.preferenceId,
    agentConfigs: await readAgentConfigs(target.preferenceId, client),
    terminalProfile: toTerminalProfileDto(target.terminalProfile)
  };
}

/**
 * Contract v39: configuring launch settings is not an onboarding act. These writes
 * store this machine's own preferences against its execution target, so they
 * resolve an already-declared target and fail with `no_execution_target_registered`
 * when the machine has none — they no longer declare it.
 */
async function requireLocalLaunchTarget(
  client: DatabaseClient,
  ctx: ServiceContext
): Promise<LocalLaunchTarget> {
  return toLocalLaunchTarget(
    await requireActingDeviceTarget({
      ctx,
      what: 'Launch settings are stored per execution target.'
    }),
    client
  );
}

/**
 * Read-only counterpart: resolves the acting machine's already-declared target and
 * returns `null` when it has none. Reading launch settings must never declare one.
 */
async function findLocalLaunchTarget(
  client: DatabaseClient,
  ctx: ServiceContext
): Promise<LocalLaunchTarget | null> {
  const target = await findActingDeviceTarget({ ctx });
  return target ? toLocalLaunchTarget(target, client) : null;
}

export async function getLaunchSettings(workspaceId?: string): Promise<LaunchSettingsDto> {
  const client = requireDatabaseClient();
  const scope = await resolveLaunchSettingsScope(workspaceId, PERMISSIONS.LAUNCH_READ, client);
  const target = await findLocalLaunchTarget(client, scope.ctx);
  return launchSettingsDto({ target, ctx: scope.ctx });
}

/** Persist the acting user's launch mechanics (pre-command/flags) for one agent. */
export async function updateAgentLaunchConfig(
  agentKey: string,
  body: UpdateAgentLaunchConfigBody,
  workspaceId?: string
): Promise<LaunchSettingsDto> {
  return requireDatabaseClient().transaction(async tx => {
    const key = agentKey.trim();
    if (!key) throw new ApiError(400, 'Agent key is required');
    const scope = await resolveLaunchSettingsScope(workspaceId, PERMISSIONS.LAUNCH_CONFIGURE, tx);
    const target = await requireLocalLaunchTarget(tx, scope.ctx);
    if (!target.preferenceId) {
      throw new ApiError(409, 'No active workspace user to store launch configs for');
    }

    const next: AgentLaunchConfigDto = {
      preCommand:
        body.preCommand !== undefined
          ? body.preCommand.trim()
          : (target.agentConfigs[key]?.preCommand ?? ''),
      flags:
        body.flags !== undefined
          ? normalizeAgentLaunchFlags(body.flags)
          : (target.agentConfigs[key]?.flags ?? [])
    };
    const configs = { ...target.agentConfigs, [key]: next };

    await tx.run(
      `UPDATE user_execution_target_preferences
          SET agent_configs_json = ?, updated_at = ?, revision = revision + 1
        WHERE id = ?`,
      [JSON.stringify(configs), nowIso(), target.preferenceId]
    );

    return launchSettingsDto({ target, ctx: scope.ctx, agentConfigs: configs });
  });
}

/** Persist the acting user's terminal profile for the local execution target. */
export async function updateTerminalProfile(
  body: UpdateTerminalProfileBody,
  workspaceId?: string
): Promise<LaunchSettingsDto> {
  return requireDatabaseClient().transaction(async tx => {
    const scope = await resolveLaunchSettingsScope(workspaceId, PERMISSIONS.LAUNCH_CONFIGURE, tx);
    // Read the stored profile without requiring a target: `persistTerminalProfile`
    // stays the call that reports a machine with no declared execution target, so
    // the no-target error path is unchanged.
    const current = await findLocalLaunchTarget(tx, scope.ctx);
    const saved = await persistTerminalProfile({
      ctx: scope.ctx,
      profile: terminalProfileFromBody(
        body,
        current ? fromTerminalProfileDto(current.terminalProfile) : DEFAULT_TERMINAL_PROFILE
      )
    });
    const target = await requireLocalLaunchTarget(tx, scope.ctx);
    return launchSettingsDto({
      target: {
        ...target,
        executionTargetId: saved.executionTargetId,
        deviceLabel: saved.deviceLabel
      },
      ctx: scope.ctx,
      terminalProfile: toTerminalProfileDto(saved.terminalProfile)
    });
  });
}

/**
 * Persist the acting user's default execution provider and viewer-on-launch.
 * This is the value a *new* execution target inherits and that any target which
 * never set its own provider follows; a target override always wins.
 */
export async function updateLaunchSessionDefaults(
  body: UpdateLaunchSessionDefaultsBody,
  workspaceId?: string
): Promise<LaunchSettingsDto> {
  return requireDatabaseClient().transaction(async tx => {
    const scope = await resolveLaunchSettingsScope(workspaceId, PERMISSIONS.LAUNCH_CONFIGURE, tx);
    const defaults = await updateActorLaunchSessionDefaults({
      ctx: scope.ctx,
      executionProvider:
        body.executionProvider === undefined
          ? undefined
          : body.executionProvider === null
            ? DEFAULT_LAUNCH_SESSION_DEFAULTS.executionProvider
            : normalizeExecutionProvider(body.executionProvider),
      openViewerOnLaunch: body.openViewerOnLaunch,
      worktreeBranchAutomationEnabled: body.worktreeBranchAutomationEnabled
    });
    // Reading the target here never declares one: the user default is stored on
    // the profile, so a machine with no execution target may still set it.
    const target = await findLocalLaunchTarget(tx, scope.ctx);
    return launchSettingsDto({ target, ctx: scope.ctx, launchSessionDefaults: defaults });
  });
}

/**
 * Toggle the acting user's worktree/branch automation default. A thin alias over
 * `updateLaunchSessionDefaults`: the flag is a user preference, not a workspace
 * setting, so `workspaceId` only picks the membership the write is authorized
 * through.
 */
export function updateWorktreeBranchAutomation(
  body: UpdateWorktreeBranchAutomationBody,
  workspaceId?: string
): Promise<LaunchSettingsDto> {
  return updateLaunchSessionDefaults(
    { worktreeBranchAutomationEnabled: body.enabled === true },
    workspaceId
  );
}

// ---- Project launch preference ---------------------------------------------

const LAUNCH_PREFERENCE_KEY = 'launchPreference';

function readPreferenceRow(
  projectId: string,
  workspaceId: string,
  workspaceUserId: string | null,
  client: DatabaseClient = requireDatabaseClient()
): Promise<{ id: string; preferences: Record<string, unknown>; revision: number } | null> {
  return readProjectUserPreferenceRow({
    db: client,
    workspaceId,
    workspaceUserId,
    projectId
  });
}

export async function getLaunchPreference(
  projectId: string,
  client: DatabaseClient = requireDatabaseClient()
): Promise<LaunchPreferenceDto> {
  const { workspaceId, workspaceUserId } = await requireProjectPermission({
    projectId,
    permission: PERMISSIONS.LAUNCH_READ,
    db: client
  });
  const row = await readPreferenceRow(projectId, workspaceId, workspaceUserId, client);
  const stored = row?.preferences[LAUNCH_PREFERENCE_KEY] as
    | Partial<LaunchPreferenceDto>
    | undefined;
  return {
    selectedAgent: stored?.selectedAgent ?? null,
    selectedModel: stored?.selectedModel ?? null,
    selectedReasoningEffort: stored?.selectedReasoningEffort ?? null
  };
}

export async function updateLaunchPreference(
  projectId: string,
  body: UpdateLaunchPreferenceBody
): Promise<LaunchPreferenceDto> {
  return requireDatabaseClient().transaction(async tx => {
    const { workspaceId, workspaceUserId } = await requireProjectPermission({
      projectId,
      permission: PERMISSIONS.LAUNCH_CONFIGURE,
      db: tx
    });

    const row = await readPreferenceRow(projectId, workspaceId, workspaceUserId, tx);
    const current = (row?.preferences[LAUNCH_PREFERENCE_KEY] ?? {}) as Partial<LaunchPreferenceDto>;
    const next: LaunchPreferenceDto = {
      selectedAgent:
        body.selectedAgent !== undefined ? body.selectedAgent : (current.selectedAgent ?? null),
      selectedModel:
        body.selectedModel !== undefined ? body.selectedModel : (current.selectedModel ?? null),
      selectedReasoningEffort:
        body.selectedReasoningEffort !== undefined
          ? body.selectedReasoningEffort
          : (current.selectedReasoningEffort ?? null)
    };

    const now = nowIso();
    if (row) {
      const preferences = { ...row.preferences, [LAUNCH_PREFERENCE_KEY]: next };
      await tx.run(
        `UPDATE project_user_preferences
            SET preferences_json = ?, updated_at = ?, revision = revision + 1
          WHERE id = ?`,
        [JSON.stringify(preferences), now, row.id]
      );
    } else {
      await tx.run(
        `INSERT INTO project_user_preferences
           (id, workspace_id, project_id, workspace_user_id, preferences_json,
            created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          newId(),
          workspaceId,
          projectId,
          workspaceUserId,
          JSON.stringify({ [LAUNCH_PREFERENCE_KEY]: next }),
          now,
          now
        ]
      );
    }
    return next;
  });
}
