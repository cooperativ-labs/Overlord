import { NextResponse } from 'next/server';

import { getPlatformUrl } from '@/lib/env';
import { createClient } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID ?? '';
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET ?? '';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const platformUrl = getPlatformUrl();

  if (error || !code) {
    const reason = error ?? 'no_code';
    return NextResponse.redirect(`${platformUrl}/?slack_error=${encodeURIComponent(reason)}`);
  }

  // Require a logged-in Overlord user to bind this install
  const userSupabase = await createClient();
  const {
    data: { user }
  } = await userSupabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${platformUrl}/login?next=%2F`);
  }

  // Exchange code for tokens with Slack
  const redirectUri = `${platformUrl}/api/integrations/slack/oauth/callback`;
  const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri
    })
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${platformUrl}/?slack_error=token_exchange_failed`);
  }

  const tokenData = (await tokenRes.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
    team?: { id: string; name: string };
    authed_user?: { id: string };
  };

  if (!tokenData.ok || !tokenData.access_token || !tokenData.team || !tokenData.bot_user_id) {
    const reason = tokenData.error ?? 'invalid_token_response';
    return NextResponse.redirect(`${platformUrl}/?slack_error=${encodeURIComponent(reason)}`);
  }

  // Get the user's organization_id
  const { data: member } = await userSupabase
    .from('members')
    .select('organization_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member?.organization_id) {
    return NextResponse.redirect(`${platformUrl}/?slack_error=no_organization`);
  }

  // Upsert the workspace row using service role (bypasses insert RLS)
  const serviceSupabase = createServiceRoleClient();
  const { error: upsertError } = await serviceSupabase.from('slack_workspaces').upsert(
    {
      user_id: user.id,
      organization_id: member.organization_id,
      team_id: tokenData.team.id,
      team_name: tokenData.team.name,
      bot_user_id: tokenData.bot_user_id,
      bot_access_token: tokenData.access_token,
      slack_user_id: tokenData.authed_user?.id ?? '',
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,team_id' }
  );

  if (upsertError) {
    console.error('[slack-oauth] upsert error:', upsertError.message);
    return NextResponse.redirect(`${platformUrl}/?slack_error=db_error`);
  }

  return NextResponse.redirect(`${platformUrl}/?slack_connected=1`);
}
