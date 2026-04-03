/// <reference lib="deno.ns" />
/**
 * install-ssh-key — Supabase Edge Function
 *
 * Connects to a remote server via SSH using a one-time password,
 * and installs the provided public key into ~/.ssh/authorized_keys.
 * The password is used only for this operation and is never stored.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { host, port, username, password, publicKey } = await req.json();

    // Validate inputs
    if (!host || !username || !password || !publicKey) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: host, username, password, publicKey' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const sshPort = port || 22;

    // Build the command to install the SSH key.
    // This uses sshpass + ssh to run a remote command that:
    // 1. Creates ~/.ssh directory if it doesn't exist
    // 2. Appends the public key to authorized_keys
    // 3. Sets correct permissions
    const escapedKey = publicKey.replace(/'/g, "'\\''");
    const remoteCommand = [
      'mkdir -p ~/.ssh',
      'chmod 700 ~/.ssh',
      'touch ~/.ssh/authorized_keys',
      'chmod 600 ~/.ssh/authorized_keys',
      `grep -qxF '${escapedKey}' ~/.ssh/authorized_keys || echo '${escapedKey}' >> ~/.ssh/authorized_keys`
    ].join(' && ');

    const process = new Deno.Command('sshpass', {
      args: [
        '-p',
        password,
        'ssh',
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'ConnectTimeout=10',
        '-p',
        String(sshPort),
        `${username}@${host}`,
        remoteCommand
      ],
      stdout: 'piped',
      stderr: 'piped'
    });

    const output = await process.output();
    const stderr = new TextDecoder().decode(output.stderr);

    if (!output.success) {
      console.error('SSH key installation failed:', stderr);

      // Provide user-friendly error messages
      let errorMessage = 'Failed to install SSH key on the server.';
      if (stderr.includes('Permission denied')) {
        errorMessage = 'Authentication failed. Please check your username and password.';
      } else if (stderr.includes('Connection refused')) {
        errorMessage = `Connection refused on ${host}:${sshPort}. Please check the host and port.`;
      } else if (stderr.includes('Connection timed out') || stderr.includes('ConnectTimeout')) {
        errorMessage = `Connection timed out to ${host}:${sshPort}. Please check the host address.`;
      } else if (stderr.includes('Could not resolve hostname')) {
        errorMessage = `Could not resolve hostname: ${host}`;
      }

      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 422,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    return new Response(
      JSON.stringify({ success: true, message: 'SSH key installed successfully' }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('install-ssh-key error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
