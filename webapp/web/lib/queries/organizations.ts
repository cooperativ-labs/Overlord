import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AddOrganizationAdminBody,
  CreateOrganizationOnboardingBody,
  UpdateOrganizationBody
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { persistActiveOrganizationId } from '../org-preferences.ts';
import { invalidateNonEverhourQueries } from '../query-invalidation.ts';
import { keys } from '../query-keys.ts';

function invalidateAll(qc: QueryClient) {
  invalidateNonEverhourQueries(qc);
}

export const useOrganizations = () =>
  useQuery({ queryKey: keys.organizations, queryFn: api.listOrganizations });

export const useOrganizationAdmins = (id: string | null) =>
  useQuery({
    queryKey: keys.organizationAdmins(id ?? '__none__'),
    queryFn: () => api.listOrganizationAdmins(id ?? ''),
    enabled: Boolean(id)
  });

export function useUploadOrganizationLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ organizationId, file }: { organizationId: string; file: File }) => {
      const stored = await api.uploadImage('organization-images', file);
      return api.updateOrganization(organizationId, { logoUrl: stored.url });
    },
    onSuccess: () => invalidateAll(qc)
  });
}

export function useCreateOrganizationOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOrganizationOnboardingBody) => api.createOrganizationOnboarding(body),
    onSuccess: data => {
      if (data.organization) persistActiveOrganizationId(data.organization.id);
      invalidateAll(qc);
    }
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOrganizationBody }) =>
      api.updateOrganization(id, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useActivateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (organizationId: string) => {
      persistActiveOrganizationId(organizationId);
      const workspaces = await api.listWorkspaces();
      const hasWorkspace = workspaces.some(
        workspace => workspace.organizationId === organizationId
      );
      if (!hasWorkspace) throw new Error('No workspace found in this organization');
      return workspaces;
    },
    onSuccess: () => {
      invalidateAll(qc);
    }
  });
}

export function useAddOrganizationAdmin(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddOrganizationAdminBody) => api.addOrganizationAdmin(organizationId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.organizationAdmins(organizationId) });
      invalidateAll(qc);
    }
  });
}

export function useRemoveOrganizationAdmin(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeOrganizationAdmin(organizationId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.organizationAdmins(organizationId) });
      invalidateAll(qc);
    }
  });
}
