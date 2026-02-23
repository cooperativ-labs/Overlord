#!/usr/bin/env node

import { resolveAuth } from './credentials.mjs';

/**
 * Parse simple CLI flags: --key value or --key=value
 * @param {string[]} args
 * @returns {Record<string, string | boolean>}
 */
function parseFlags(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        result[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          result[key] = args[i + 1];
          i++;
        } else {
          result[key] = true;
        }
      }
    }
  }
  return result;
}

async function apiPost(platformUrl, token, path, body) {
  const requestUrl = `${platformUrl}${path}`;
  let res;
  try {
    res = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const causeCode = (
      typeof error === 'object' &&
      error !== null &&
      'cause' in error &&
      typeof error.cause === 'object' &&
      error.cause !== null &&
      'code' in error.cause
    ) ? String(error.cause.code) : '';

    let hint = 'Check your network and Overlord server settings.';
    if (causeCode === 'ECONNREFUSED') {
      hint = 'Connection refused. Verify Overlord is running and PLATFORM_URL points to the correct port.';
    } else if (causeCode === 'ENOTFOUND') {
      hint = 'Host not found. Verify PLATFORM_URL uses a valid hostname.';
    } else if (causeCode === 'ETIMEDOUT') {
      hint = 'Connection timed out. Verify server availability and local firewall/VPN settings.';
    } else if (requestUrl.includes('localhost') || requestUrl.includes('127.0.0.1')) {
      hint = 'Local server unreachable. Start Overlord (usually http://localhost:3000) or update PLATFORM_URL.';
    }

    throw new Error(
      `Network error calling ${requestUrl}: ${message}${causeCode ? ` (${causeCode})` : ''}\n${hint}`
    );
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`API error (${res.status}): ${data.error ?? JSON.stringify(data)}`);
  }

  return data;
}

/** Read SESSION_KEY and TICKET_ID from env if flags not provided */
function resolveSessionFlags(flags) {
  return {
    sessionKey: String(flags['session-key'] ?? process.env.SESSION_KEY ?? ''),
    ticketId: String(flags['ticket-id'] ?? process.env.TICKET_ID ?? '')
  };
}

function requireFlag(flags, name, envAlias) {
  const value = flags[name] ?? (envAlias ? process.env[envAlias] : undefined);
  if (!value) {
    throw new Error(`--${name} is required (or set ${envAlias ?? name.toUpperCase()})`);
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// attach
// ---------------------------------------------------------------------------

async function protocolAttach(args) {
  const flags = parseFlags(args);
  const ticketId = requireFlag(flags, 'ticket-id', 'TICKET_ID');
  const { platformUrl, agentToken } = resolveAuth();

  const body = {
    ticketId,
    agentIdentifier: String(flags.agent ?? 'claude-code'),
    connectionMethod: String(flags.method ?? 'cli'),
    metadata: {}
  };

  const data = await apiPost(platformUrl, agentToken, '/api/protocol/attach', body);

  const sessionKey = data.session?.sessionKey;
  console.log(JSON.stringify(data, null, 2));

  if (sessionKey) {
    // Emit a machine-readable line for easy shell capture:
    // SESSION_KEY=$(ovld protocol attach --ticket-id ... | grep ^SESSION_KEY= | cut -d= -f2)
    process.stderr.write(`\nSESSION_KEY=${sessionKey}\n`);
  }
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

async function protocolUpdate(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  const summary = requireFlag(flags, 'summary', undefined);

  const { platformUrl, agentToken } = resolveAuth();

  const body = {
    sessionKey,
    ticketId,
    summary,
    ...(flags.phase ? { phase: String(flags.phase) } : {}),
    ...(flags['payload-json'] ? { payload: JSON.parse(String(flags['payload-json'])) } : {})
  };

  const data = await apiPost(platformUrl, agentToken, '/api/protocol/update', body);
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// decision
// ---------------------------------------------------------------------------

async function protocolDecision(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  const title = requireFlag(flags, 'title', undefined);
  const rationale = String(flags.rationale ?? '');
  const impact = String(flags.impact ?? '');

  const { platformUrl, agentToken } = resolveAuth();

  const body = {
    sessionKey,
    ticketId,
    title,
    rationale,
    impact,
    ...(flags.phase ? { phase: String(flags.phase) } : {}),
    ...(flags['payload-json'] ? { payload: JSON.parse(String(flags['payload-json'])) } : {})
  };

  const data = await apiPost(platformUrl, agentToken, '/api/protocol/decision', body);
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// ask
// ---------------------------------------------------------------------------

async function protocolAsk(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  const question = requireFlag(flags, 'question', undefined);

  const { platformUrl, agentToken } = resolveAuth();

  const body = {
    sessionKey,
    ticketId,
    question,
    ...(flags.phase ? { phase: String(flags.phase) } : {}),
    ...(flags['payload-json'] ? { payload: JSON.parse(String(flags['payload-json'])) } : {})
  };

  const data = await apiPost(platformUrl, agentToken, '/api/protocol/ask', body);
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// read-context
// ---------------------------------------------------------------------------

async function protocolReadContext(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');

  const { platformUrl, agentToken } = resolveAuth();

  const body = {
    sessionKey,
    ticketId,
    ...(flags.query ? { query: String(flags.query) } : {}),
    ...(flags.limit ? { limit: parseInt(String(flags.limit), 10) } : {})
  };

  const data = await apiPost(platformUrl, agentToken, '/api/protocol/read-context', body);
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// write-context
// ---------------------------------------------------------------------------

async function protocolWriteContext(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  const key = requireFlag(flags, 'key', undefined);

  if (flags.value === undefined) {
    throw new Error('--value is required');
  }

  let value;
  try {
    value = JSON.parse(String(flags.value));
  } catch {
    value = String(flags.value);
  }

  const { platformUrl, agentToken } = resolveAuth();

  const body = {
    sessionKey,
    ticketId,
    key,
    value,
    ...(flags.tags ? { tags: String(flags.tags).split(',').map(t => t.trim()) } : {})
  };

  const data = await apiPost(platformUrl, agentToken, '/api/protocol/write-context', body);
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// deliver
// ---------------------------------------------------------------------------

async function protocolDeliver(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  const summary = requireFlag(flags, 'summary', undefined);

  const { platformUrl, agentToken } = resolveAuth();

  let artifacts = [];
  if (flags['artifacts-json']) {
    try {
      artifacts = JSON.parse(String(flags['artifacts-json']));
    } catch {
      throw new Error('--artifacts-json must be valid JSON');
    }
  }

  const body = { sessionKey, ticketId, summary, artifacts };

  const data = await apiPost(platformUrl, agentToken, '/api/protocol/deliver', body);
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function runProtocolCommand(subcommand, args) {
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    console.log(`ovld protocol <subcommand> [flags]

Subcommands:
  attach          Start a session on a ticket
  update          Post a progress update
  decision        Record an architectural decision
  ask             Post a blocking question
  read-context    Retrieve shared context
  write-context   Store a key/value in shared context
  deliver         Mark the ticket complete and deliver artifacts

Flags read from env vars when not provided:
  SESSION_KEY, TICKET_ID, PLATFORM_URL, AGENT_TOKEN

Examples:
  ovld protocol attach --ticket-id abc-123
  ovld protocol update --session-key <key> --ticket-id <id> --summary "Did X"
  ovld protocol decision --session-key <key> --ticket-id <id> --title "Use Postgres" --rationale "..."
  ovld protocol ask --session-key <key> --ticket-id <id> --question "Which approach?"
  ovld protocol read-context --session-key <key> --ticket-id <id>
  ovld protocol write-context --session-key <key> --ticket-id <id> --key "arch" --value '"monorepo"'
  ovld protocol deliver --session-key <key> --ticket-id <id> --summary "Done"
`);
    return;
  }

  if (subcommand === 'attach') { await protocolAttach(args); return; }
  if (subcommand === 'update') { await protocolUpdate(args); return; }
  if (subcommand === 'decision') { await protocolDecision(args); return; }
  if (subcommand === 'ask') { await protocolAsk(args); return; }
  if (subcommand === 'read-context') { await protocolReadContext(args); return; }
  if (subcommand === 'write-context') { await protocolWriteContext(args); return; }
  if (subcommand === 'deliver') { await protocolDeliver(args); return; }

  console.error(`Unknown protocol subcommand: ${subcommand}\n`);
  console.log('Run: ovld protocol help');
  process.exit(1);
}
