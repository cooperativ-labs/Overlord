/**
 * Assembles the `GET /api/meta` response shape (`MetaDto`): the caller's
 * active organization, every organization they belong to, the accessible
 * workspaces of the active organization, and the server's default-scope
 * workspace. Shared by the `/api/meta` route and the onboarding routes (which
 * return the refreshed meta after creating the caller's first
 * organization/workspace) so the shape can never drift between the two.
 *
 * Deliberately depends on both `organizations.ts` and `workspaces.ts` (rather
 * than living in either) so neither service module needs to import the other.
 */

import { githubOAuthConfigFromEnv } from '@overlord/auth';
import type { MetaDto } from '@overlord/contract';

import type { BackendMode, OverlordConfig } from '../../cli/src/config.ts';
import {
  DATABASE_DIALECT,
  DATABASE_PATH,
  getActiveProfileId,
  getImplicitWorkspaceIdOrNull
} from '../db.ts';
import { resolveLocalTargetServerCapability } from '../execution/local-target-capability.ts';
import { getActiveOrganizationIdOrNull, listOrganizationsForUser } from '../organizations.ts';
import { getDefaultProjectPreference } from '../repository.ts';
import { getSqlStudioState } from '../sql-studio/sql-studio-manager.ts';
import { listWorkspacesForOrganization } from '../workspaces.ts';

export async function buildMeta(): Promise<MetaDto> {
  const profileId = getActiveProfileId();
  const activeOrganizationId = await getActiveOrganizationIdOrNull();
  const organizations = profileId ? await listOrganizationsForUser(profileId) : [];
  const organization = organizations.find(org => org.isActive) ?? null;
  const workspaces = activeOrganizationId
    ? await listWorkspacesForOrganization(activeOrganizationId)
    : [];
  const activeWorkspaceId = getImplicitWorkspaceIdOrNull();
  const workspace = activeWorkspaceId ? (workspaces.find(w => w.isActive) ?? null) : null;
  const { projectId: defaultProjectId } = await getDefaultProjectPreference();

  return { organization, organizations, workspaces, workspace, defaultProjectId };
}

/**
 * Which interactive login providers this build offers. `email` is always
 * available; `github` only when OAuth credentials are configured. The single
 * source for `GET /api/auth-providers` (public, pre-authentication) and the
 * `authProviders` member of `GET /api/meta`, so the two cannot drift.
 */
export function authProviders(): { email: true; github: boolean } {
  return { email: true, github: githubOAuthConfigFromEnv() !== null };
}

/**
 * Hosted Postgres deployments have no overlord.toml, so `config.backendMode`
 * defaults to local; Postgres therefore means cloud. Shared by `/api/meta` and
 * the chat/connections `cloud` predicate.
 */
export function effectiveBackendMode(config: Pick<OverlordConfig, 'backendMode'>): BackendMode {
  return DATABASE_DIALECT === 'postgres' ? 'cloud' : config.backendMode;
}

/** `GET /api/meta` (`ServerMetaDto`): the organization/workspace meta plus server facts. */
export async function buildServerMeta(args: {
  config: Pick<OverlordConfig, 'backendMode'>;
  bindHost: string;
  bindPort: number;
  mcpEnabled: boolean;
}) {
  const { config, bindHost, bindPort, mcpEnabled } = args;
  const sqlStudio = getSqlStudioState();
  return {
    ...(await buildMeta()),
    databasePath: DATABASE_PATH,
    backendMode: effectiveBackendMode(config),
    web: {
      host: bindHost,
      port: bindPort,
      url: `http://${bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost}:${bindPort}`
    },
    sqlStudio,
    authProviders: authProviders(),
    // Capabilities scoped to what this build supports. Launching queues
    // execution requests for a runner; execution-target management remains
    // CLI-only.
    capabilities: {
      projects: true,
      missions: true,
      objectives: true,
      realtime: true,
      sqlStudio: sqlStudio.enabled,
      launchAgents: true,
      executionTargets: false,
      localTarget: resolveLocalTargetServerCapability({ dialect: DATABASE_DIALECT }),
      mcp: mcpEnabled
    }
  };
}
