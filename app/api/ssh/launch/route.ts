// Must run in Node.js runtime for ssh2 support.
export const runtime = 'nodejs';

import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { Client } from 'ssh2';

import { getPlatformUrl } from '@/lib/env';
import { createClient } from '@/supabase/utils/server';

type LaunchBody = {
  profileId: string;
  ticketId: string;
  agentToken: string;
  /** Defaults to 'claude' */
  agent?: 'claude' | 'codex' | 'cursor' | 'gemini';
};

/** Short ticket ID for the tmux session name (first 8 chars). */
function shortId(ticketId: string): string {
  return ticketId.replace(/-/g, '').slice(0, 8);
}

function buildRemoteCommand({
  ticketId,
  agentToken,
  platformUrl,
  workingDirectory,
  agent,
}: {
  ticketId: string;
  agentToken: string;
  platformUrl: string;
  workingDirectory: string;
  agent: string;
}): { sessionName: string; command: string } {
  const sessionName = `ol-${shortId(ticketId)}`;
  const envBlock = [
    `OVERLORD_URL=${platformUrl}`,
    `AGENT_TOKEN=${agentToken}`,
    `TICKET_ID=${ticketId}`,
  ].join(' ');

  const agentCmd = agent === 'codex'
    ? 'npx overlord run codex'
    : agent === 'cursor'
      ? 'npx overlord run cursor'
      : agent === 'gemini'
        ? 'npx overlord run gemini'
        : 'npx overlord run claude';

  // Use `tmux new-session -A` so re-clicking the button re-attaches to an
  // existing session instead of erroring.
  const command = [
    `cd ${workingDirectory}`,
    `&&`,
    `tmux new-session -A -d -s ${sessionName}`,
    `"${envBlock} ${agentCmd}"`,
  ].join(' ');

  return { sessionName, command };
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: LaunchBody = await request.json();
    const { profileId, ticketId, agentToken, agent = 'claude' } = body;

    if (!profileId || !ticketId || !agentToken) {
      return NextResponse.json({ error: 'profileId, ticketId, and agentToken are required.' }, { status: 400 });
    }

    // Fetch the full profile (including private key) — creator-only via RLS.
    const { data: profile, error: profileError } = await supabase
      .from('ssh_server_profiles')
      .select('*')
      .eq('id', profileId)
      .eq('created_by', user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Server profile not found.' }, { status: 404 });
    }

    const platformUrl = getPlatformUrl();
    const { sessionName, command } = buildRemoteCommand({
      ticketId,
      agentToken,
      platformUrl,
      workingDirectory: profile.working_directory,
      agent,
    });

    await runSshCommand({
      host: profile.host,
      port: profile.port,
      username: profile.username,
      privateKey: profile.private_key,
      command,
    });

    return NextResponse.json({
      sessionName,
      host: profile.host,
      attachCommand: `tmux attach -t ${sessionName}`,
    });
  } catch (error) {
    console.error('[ssh/launch]', error);
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : 'Failed to launch agent.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function runSshCommand({
  host,
  port,
  username,
  privateKey,
  command,
}: {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  command: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on('ready', () => {
      conn.exec(command, (err: Error | undefined, stream: NodeJS.ReadWriteStream & { stderr: NodeJS.Readable }) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        let stderr = '';
        stream
          .on('close', (code: number) => {
            conn.end();
            if (code !== 0) {
              reject(new Error(`Remote command exited with code ${code}. stderr: ${stderr}`));
            } else {
              resolve();
            }
          })
          .stderr.on('data', (chunk: { toString(): string }) => {
            stderr += chunk.toString();
          });
      });
    });

    conn.on('error', reject);

    conn.connect({
      host,
      port,
      username,
      privateKey,
      // Reasonable timeout for interactive scenarios.
      readyTimeout: 15_000,
    });
  });
}
