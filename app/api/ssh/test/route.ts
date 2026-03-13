// Must run in Node.js runtime for ssh2 support.
export const runtime = 'nodejs';

import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { Client } from 'ssh2';

import { createClient } from '@/supabase/utils/server';

type TestBody = {
  profileId?: string;
  /** Inline credentials for testing before saving. */
  host?: string;
  port?: number;
  username?: string;
  privateKey?: string;
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: TestBody = await request.json();
    let host: string, port: number, username: string, privateKey: string;

    if (body.profileId) {
      const { data: profile, error } = await supabase
        .from('ssh_server_profiles')
        .select('host, port, username, private_key')
        .eq('id', body.profileId)
        .eq('created_by', user.id)
        .single();
      if (error || !profile) {
        return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
      }
      ({ host, port, username } = profile);
      privateKey = profile.private_key;
    } else {
      if (!body.host || !body.username || !body.privateKey) {
        return NextResponse.json({ error: 'host, username, and privateKey are required.' }, { status: 400 });
      }
      host = body.host;
      port = body.port ?? 22;
      username = body.username;
      privateKey = body.privateKey;
    }

    await testSshConnection({ host, port, username, privateKey });

    // If this was an existing profile, stamp last_tested_at.
    if (body.profileId) {
      await supabase
        .from('ssh_server_profiles')
        .update({ last_tested_at: new Date().toISOString() })
        .eq('id', body.profileId)
        .eq('created_by', user.id);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[ssh/test]', error);
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : 'Connection failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function testSshConnection({
  host,
  port,
  username,
  privateKey,
}: {
  host: string;
  port: number;
  username: string;
  privateKey: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.end();
      resolve();
    });
    conn.on('error', reject);
    conn.connect({ host, port, username, privateKey, readyTimeout: 10_000 });
  });
}
