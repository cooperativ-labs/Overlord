import type { Database } from '@/types/database.types';

export type OrganizationRole = Database['public']['Enums']['organization_role'];

/** Ascending privilege; must match hierarchy used in org settings UI and invitations. */
export const ORGANIZATION_ROLE_ORDER: OrganizationRole[] = ['VIEWER', 'AGENT', 'MANAGER', 'ADMIN'];
