import { getSupabase } from '@/lib/supabase';
import type { LaunchAgentType, Server } from '@/lib/types';
import { runCommand } from '@/modules/ssh';

import {
  DEFAULT_SERVER_TERMINAL_CUSTOM_COMMAND,
  getServerTerminalPreference,
  type ServerTerminalPreference
} from './server-terminal-preferences';

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

export function resolvePlatformUrl(): string {
  const explicitUrl = process.env.EXPO_PUBLIC_OVERLORD_URL?.trim();
  if (explicitUrl) {
    return explicitUrl.replace(/\/+$/, '');
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      const host = parsed.hostname;
      // Only permit the loopback addresses. Private-range IPv4 hosts (e.g. a
      // devbox reachable on the LAN) would otherwise fall back to cleartext
      // HTTP even when the Supabase URL has drifted.
      const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      const allowInsecure = process.env.EXPO_PUBLIC_OVERLORD_ALLOW_INSECURE_LOCAL === 'true';

      if (isLoopback || allowInsecure) {
        return `http://${host}:3000`;
      }
    } catch {
      // Fall through to the hosted default.
    }
  }

  return 'https://www.ovld.ai';
}

export async function resolveLaunchOAuthSession(): Promise<{
  accessToken: string;
  organizationId: number;
}> {
  const supabase = getSupabase();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  const accessToken = session?.access_token?.trim();
  const userId = session?.user?.id?.trim();

  if (!accessToken || !userId) {
    throw new Error('You must be signed in to launch a remote ticket session.');
  }

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('organization_id')
    .eq('user_id', userId)
    .order('organization_id', { ascending: true })
    .limit(1)
    .single();

  if (memberError || !member) {
    throw new Error(memberError?.message ?? 'Could not determine your organization.');
  }

  return {
    accessToken,
    organizationId: member.organization_id
  };
}

function buildRemoteLaunchCommand({
  ticketId,
  ticketSequence,
  agent,
  platformUrl,
  accessToken,
  organizationId,
  terminalPreference
}: {
  ticketId: string;
  ticketSequence: number | null;
  agent: LaunchAgentType;
  platformUrl: string;
  accessToken: string;
  organizationId: number;
  terminalPreference: ServerTerminalPreference;
}): string {
  const windowName = `ticket-${ticketSequence ?? ticketId.slice(0, 8)}`;
  // Source shell profile so nvm/node/ovld are in PATH, then run the
  // launch command. If it fails, keep the tmux window open with the
  // error visible instead of closing immediately.
  const innerCmd = [
    `OVERLORD_URL=${quoteShell(platformUrl)}`,
    `OVERLORD_ACCESS_TOKEN=${quoteShell(accessToken)}`,
    `OVERLORD_ORGANIZATION_ID=${quoteShell(String(organizationId))}`,
    `TICKET_ID=${quoteShell(ticketId)}`,
    'ovld launch',
    agent,
    '--ticket-id',
    ticketId
  ].join(' ');
  const profileSetup = [
    '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"',
    '[ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc"',
    '[ -f "$HOME/.profile" ] && . "$HOME/.profile"',
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"'
  ].join('; ');
  const launcher = `${profileSetup}; ${innerCmd}; EXIT_CODE=$?; if [ $EXIT_CODE -ne 0 ]; then echo ""; echo "[ovld launch exited with code $EXIT_CODE]"; echo "Press Enter to close this window..."; read; fi`;

  if (terminalPreference.launchMode === 'custom') {
    const trimmedTemplate = terminalPreference.customCommand.trim();
    const commandTemplate =
      trimmedTemplate.length > 0 && trimmedTemplate.includes('{command}')
        ? trimmedTemplate
        : DEFAULT_SERVER_TERMINAL_CUSTOM_COMMAND;

    return commandTemplate
      .replaceAll('{command}', quoteShell(launcher))
      .replaceAll('{window}', quoteShell(windowName))
      .replaceAll('{ticketId}', quoteShell(ticketId));
  }

  return [
    'CURRENT_PATH="$(tmux list-panes -a -F \'#{?pane_active,1,0} #{pane_current_path}\' 2>/dev/null | awk \'$1 == 1 { $1 = ""; sub(/^ /, ""); print; exit }\')"',
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
  const { accessToken, organizationId } = await resolveLaunchOAuthSession();
  const terminalPreference = await getServerTerminalPreference();
  const command = buildRemoteLaunchCommand({
    ticketId,
    ticketSequence,
    agent,
    platformUrl,
    accessToken,
    organizationId,
    terminalPreference
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
  const { accessToken, organizationId } = await resolveLaunchOAuthSession();
  const terminalPreference = await getServerTerminalPreference();
  const command = buildRemoteLaunchCommand({
    ticketId,
    ticketSequence,
    agent,
    platformUrl,
    accessToken,
    organizationId,
    terminalPreference
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
