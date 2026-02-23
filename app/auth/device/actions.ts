'use server';

import { redirect } from 'next/navigation';

import { createServiceRoleClient } from '@/supabase/utils/service-role';
import { createClient } from '@/supabase/utils/server';

export async function approveDevice(userCode: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/auth/device?code=${encodeURIComponent(userCode)}`);
  }

  const service = createServiceRoleClient();

  // Find the device code record
  const { data: deviceCode, error: findError } = await service
    .from('device_auth_codes')
    .select('id, expires_at, approved_at')
    .eq('user_code', userCode)
    .single();

  if (findError || !deviceCode) {
    redirect('/auth/device?error=not_found');
  }

  if (new Date(deviceCode.expires_at) < new Date()) {
    redirect('/auth/device?error=expired');
  }

  if (deviceCode.approved_at) {
    redirect('/auth/device?error=already_approved');
  }

  // Look up user's first organization
  const { data: orgData } = await supabase
    .from('organizations')
    .select('id')
    .order('id', { ascending: true })
    .limit(1)
    .single();

  if (!orgData) {
    redirect('/auth/device?error=no_organization');
  }

  // Create an agent token for this user
  const { data: tokenData, error: tokenError } = await service
    .from('agent_tokens')
    .insert({
      user_id: user.id,
      organization_id: orgData.id,
      name: 'CLI Token'
    })
    .select('token')
    .single();

  if (tokenError || !tokenData) {
    redirect('/auth/device?error=token_creation_failed');
  }

  // Approve the device code
  const { error: updateError } = await service
    .from('device_auth_codes')
    .update({
      user_id: user.id,
      access_token: tokenData.token,
      approved_at: new Date().toISOString()
    })
    .eq('id', deviceCode.id);

  if (updateError) {
    redirect('/auth/device?error=approval_failed');
  }

  redirect('/auth/device?approved=1');
}
