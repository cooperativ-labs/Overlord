'use server';

import { cookies } from 'next/headers';

import { SELECTED_ORG_COOKIE } from '@/lib/selected-org';
import { createClient } from '@/supabase/utils/server';

export type UserOrganization = {
  id: number;
  name: string;
};

export async function getUserOrganizations(): Promise<UserOrganization[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('id,name')
    .order('name', { ascending: true });
  return (data ?? []) as UserOrganization[];
}

export async function setSelectedOrgAction(orgId: number | null): Promise<void> {
  const cookieStore = await cookies();
  if (orgId === null) {
    cookieStore.delete(SELECTED_ORG_COOKIE);
  } else {
    cookieStore.set(SELECTED_ORG_COOKIE, String(orgId), {
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
      sameSite: 'lax'
    });
  }
}
