/**
 * Explicit workspace/organization discovery for product and agent surfaces.
 * This is deliberately a projection of the authentication snapshot, not a
 * workspace selector: it never changes request scope or token consent.
 */

import type {
  AuthorizedWorkspaceDiscoveryDto,
  AuthorizedWorkspaceDto
} from '../webapp/shared/contract.ts';

import { listWorkspaceConsentOrganizations } from './auth.ts';
import {
  type AuthorizedWorkspace,
  getAuthorizedWorkspacesContext,
  resolveActiveProfileId
} from './db.ts';
import { ApiError } from './errors.ts';
import { listOrganizationsForUser } from './organizations.ts';

function toDto(workspace: AuthorizedWorkspace, organizationId: string): AuthorizedWorkspaceDto {
  return {
    workspaceId: workspace.workspaceId,
    workspaceUserId: workspace.workspaceUserId,
    organizationId,
    slug: workspace.workspace.slug,
    name: workspace.workspace.name,
    kind: workspace.workspace.kind,
    roleKeys: workspace.roleKeys
  };
}

export async function getAuthorizedWorkspaceDiscovery(): Promise<AuthorizedWorkspaceDiscoveryDto> {
  const profileId = await resolveActiveProfileId();
  if (!profileId) throw new ApiError(401, 'Authentication required');
  const snapshot = getAuthorizedWorkspacesContext();
  const organizations = await listOrganizationsForUser(profileId);

  if (snapshot?.organizationId) {
    return {
      organizationId: snapshot.organizationId,
      organizations: organizations.filter(
        organization => organization.id === snapshot.organizationId
      ),
      workspaces: snapshot.workspaces.map(workspace => toDto(workspace, snapshot.organizationId!)),
      selectionRequired: false
    };
  }

  const consentOrganizations = await listWorkspaceConsentOrganizations(profileId);
  return {
    organizationId: null,
    organizations,
    workspaces: consentOrganizations.flatMap(organization =>
      organization.workspaces.map(workspace => toDto(workspace, organization.id))
    ),
    selectionRequired: consentOrganizations.length > 1
  };
}
