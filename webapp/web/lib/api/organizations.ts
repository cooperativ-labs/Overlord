import type {
  AddOrganizationAdminBody,
  CreateOrganizationOnboardingBody,
  MetaDto,
  OrganizationAdminDto,
  OrganizationDto,
  UpdateOrganizationBody
} from '@overlord/contract';

import { request } from './request.ts';

export const organizationsApi = {
  createOrganizationOnboarding: (body: CreateOrganizationOnboardingBody) =>
    request<MetaDto>('POST', '/api/onboarding', body),

  listOrganizations: () => request<OrganizationDto[]>('GET', '/api/organizations'),
  updateOrganization: (id: string, body: UpdateOrganizationBody) =>
    request<OrganizationDto>('PATCH', `/api/organizations/${id}`, body),
  listOrganizationAdmins: (id: string) =>
    request<OrganizationAdminDto[]>('GET', `/api/organizations/${id}/admins`),
  addOrganizationAdmin: (id: string, body: AddOrganizationAdminBody) =>
    request<OrganizationAdminDto[]>('POST', `/api/organizations/${id}/admins`, body),
  removeOrganizationAdmin: (id: string, userId: string) =>
    request<OrganizationAdminDto[]>(
      'DELETE',
      `/api/organizations/${id}/admins/${encodeURIComponent(userId)}`
    )
};
