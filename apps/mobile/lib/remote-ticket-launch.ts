import { getSupabase } from '@/lib/supabase';
import type { LaunchAgentType, Server } from '@/lib/types';
import { runCommand } from '@/modules/ssh';

type LaunchTicketOnServerParams = {
  ticketId: string;
  ticketSequence: number | null;
  agent: LaunchAgentType;
  server: Server;
  keyTag: string;
};

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolvePlatformUrl(): string {
  const explicitUrl = process.env.EXPO_PUBLIC_OVERLORD_URL?.trim();
  if (explicitUrl) {
    return explicitUrl.replace(/\/+$/, '');
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      const host = parsed.hostname;
      const isLocalLike =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        /^\d+\.\d+\.\d+\.\d+$/.test(host);

      if (isLocalLike) {
        return `http://${host}:3000`;
      }
    } catch {
      // Fall through to the hosted default.
    }
  }

  return 'https://www.ovld.ai';
}

async function ensureAgentToken(): Promise<string> {
  const supabase = getSupabase();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to launch a remote ticket session.');
  }

  const now = Date.now();
  const { data: existingToken, error: tokenError } = await supabase
    .from('agent_tokens')
    .select('token, expires_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tokenError) {
    throw new Error(tokenError.message);
  }

  if (
    existingToken?.token &&
    (!existingToken.expires_at || new Date(existingToken.expires_at).getTime() > now)
  ) {
    return existingToken.token;
  }

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('organization_id')
    .eq('user_id', user.id)
    .order('organization_id', { ascending: true })
    .limit(1)
    .single();

  if (memberError || !member) {
    throw new Error(memberError?.message ?? 'Could not determine your organization.');
  }

  const { data: createdToken, error: createError } = await supabase
    .from('agent_tokens')
    .insert({
      user_id: user.id,
      organization_id: member.organization_id,
      name: 'CLI Token'
    })
    .select('token')
    .single();

  if (createError || !createdToken?.token) {
    throw new Error(createError?.message ?? 'Failed to create a new agent token.');
  }

  return createdToken.token;
}

function buildRemoteLaunchCommand({
  ticketId,
  ticketSequence,
  agent,
  platformUrl,
  agentToken
}: {
  ticketId: string;
  ticketSequence: number | null;
  agent: LaunchAgentType;
  platformUrl: string;
  agentToken: string;
}): string {
  const windowName = `ticket-${ticketSequence ?? ticketId.slice(0, 8)}`;
  const launcher = [
    `OVERLORD_URL=${quoteShell(platformUrl)}`,
    `AGENT_TOKEN=${quoteShell(agentToken)}`,
    `TICKET_ID=${quoteShell(ticketId)}`,
    'ovld connect',
    agent,
    '--ticket-id',
    ticketId
  ].join(' ');

  return [
    'CURRENT_PATH="$(tmux list-panes -a -F \'#{?pane_active,1,0} #{pane_current_path}\' 2>/dev/null | awk \'$1 == 1 { $1 = \"\"; sub(/^ /, \"\"); print; exit }\')"',
    'if [ -z "$CURRENT_PATH" ]; then CURRENT_PATH="$(tmux list-panes -a -F \'#{pane_current_path}\' 2>/dev/null | head -n 1)"; fi',
    'if [ -z "$CURRENT_PATH" ]; then CURRENT_PATH="$HOME"; fi',
    'SESSION_NAME="$(tmux list-sessions -F \'#{session_name}\' 2>/dev/null | head -n 1)"',
    `WINDOW_NAME=${quoteShell(windowName)}`,
    `LAUNCH_CMD=${quoteShell(launcher)}`,
    'if [ -n "$SESSION_NAME" ]; then',
    '  tmux new-window -d -t "${SESSION_NAME}:" -n "$WINDOW_NAME" -c "$CURRENT_PATH" "$LAUNCH_CMD"',
    'else',
    '  tmux new-session -d -s overlord -n "$WINDOW_NAME" -c "$CURRENT_PATH" "$LAUNCH_CMD"',
    '  SESSION_NAME="overlord"',
    'fi',
    'printf "Started %s in tmux session %s at %s\\n" "$WINDOW_NAME" "$SESSION_NAME" "$CURRENT_PATH"'
  ].join('; ');
}

type LaunchTicketOnServerWithPasswordParams = {
  ticketId: string;
  ticketSequence: number | null;
  agent: LaunchAgentType;
  server: Server;
  password: string;
};

export async function launchTicketOnServerWithPassword({
  ticketId,
  ticketSequence,
  agent,
  server,
  password
}: LaunchTicketOnServerWithPasswordParams) {
  const platformUrl = resolvePlatformUrl();
  const agentToken = await ensureAgentToken();
  const command = buildRemoteLaunchCommand({
    ticketId,
    ticketSequence,
    agent,
    platformUrl,
    agentToken
  });

  return runCommand({
    host: server.host,
    port: server.port,
    username: server.username,
    transport: server.transport,
    command,
    password,
    expectedHostKeyFingerprint: server.host_key_fingerprint
  });
}

export async function launchTicketOnServer({
  ticketId,
  ticketSequence,
  agent,
  server,
  keyTag
}: LaunchTicketOnServerParams) {
  const platformUrl = resolvePlatformUrl();
  const agentToken = await ensureAgentToken();
  const command = buildRemoteLaunchCommand({
    ticketId,
    ticketSequence,
    agent,
    platformUrl,
    agentToken
  });

  return runCommand({
    host: server.host,
    port: server.port,
    username: server.username,
    // Always use 'ssh' transport when authenticating with a device key,
    // even for Tailscale SSH servers — the native module only attempts
    // pubkey auth when transport is 'ssh'.
    transport: 'ssh',
    command,
    keyTag,
    expectedHostKeyFingerprint: server.host_key_fingerprint
  });
}
