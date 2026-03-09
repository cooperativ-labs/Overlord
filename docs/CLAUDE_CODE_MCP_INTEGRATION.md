# Claude Code MCP Integration Guide

This guide shows how to configure Claude Code to connect to the Overlord MCP service and work on tickets.

## Quick Start

### 1. Add MCP Server Configuration

Add the following to your Claude Code configuration (typically `~/.claude/settings.json` or via the CLI):

```json
{
  "mcp_servers": {
    "overlord": {
      "command": "node",
      "args": ["./mcp-client.js"],
      "env": {
        "OVERLORD_URL": "https://ovld.ai",
        "SUPABASE_URL": "https://zitmmhvbilhjjdwgxlfm.supabase.co",
        "SUPABASE_OAUTH_CLIENT_ID": "577e4468-a806-489e-8b99-206471e7442c",
        "SUPABASE_OAUTH_REDIRECT_URI": "http://127.0.0.1:3000/callback"
      }
    }
  }
}
```

### 2. Create MCP Client Script

Create `./mcp-client.js` in your project:

```javascript
// mcp-client.js - Overlord MCP Client for Claude Code
const http = require('http');
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OVERLORD_URL = process.env.OVERLORD_URL || 'https://ovld.ai';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zitmmhvbilhjjdwgxlfm.supabase.co';
const CLIENT_ID = process.env.SUPABASE_OAUTH_CLIENT_ID || '';
const REDIRECT_URI = process.env.SUPABASE_OAUTH_REDIRECT_URI || 'http://127.0.0.1:3000/callback';

const TOKEN_FILE = path.join(process.env.HOME || '/tmp', '.overlord-agent-token');

// ============================================================================
// PKCE Helper Functions
// ============================================================================

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64').replace(/[+/=]/g, c => ({
    '+': '-', '/': '_', '=': ''
  }[c]));
}

function generateCodeChallenge(verifier) {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));
}

// ============================================================================
// Fetch Wrapper
// ============================================================================

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const protocol = isHttps ? https : http;
    const { method = 'GET', headers = {}, body } = options;

    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'User-Agent': 'Overlord-MCP-Client/1.0',
        ...headers
      }
    };

    const req = protocol.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ============================================================================
// Authentication
// ============================================================================

async function loadStoredToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return null;
  }
}

function saveToken(token) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
}

async function authenticate() {
  const existingToken = await loadStoredToken();
  if (existingToken) {
    console.error(`[overlord-mcp] Using stored token from ${TOKEN_FILE}`);
    return existingToken;
  }

  console.error('[overlord-mcp] No token found. Starting OAuth flow...');

  // 1. Start local server to capture redirect
  const redirectServer = await startRedirectServer();
  const authPort = redirectServer.port;
  const actualRedirectUri = `http://127.0.0.1:${authPort}/callback`;

  // 2. Generate PKCE
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // 3. Build auth URL
  const authUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', actualRedirectUri);
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  console.error(`[overlord-mcp] Open this URL in your browser:\n${authUrl}`);

  // 4. Wait for callback
  const authCode = await new Promise((resolve) => {
    redirectServer.onCallback = resolve;
  });

  redirectServer.close();

  console.error('[overlord-mcp] Authorization code received. Exchanging...');

  // 5. Exchange code for Supabase JWT
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: authCode,
      client_id: CLIENT_ID,
      redirect_uri: actualRedirectUri,
      code_verifier: codeVerifier
    })
  });

  if (tokenRes.status !== 200) {
    throw new Error(`[overlord-mcp] Token exchange failed: ${tokenRes.status}`);
  }

  const supabaseJwt = tokenRes.data.access_token;
  console.error('[overlord-mcp] Supabase JWT obtained. Exchanging for agent token...');

  // 6. Exchange Supabase JWT for Overlord agent token
  const agentRes = await fetch(`${OVERLORD_URL}/api/auth/token`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${supabaseJwt}` }
  });

  if (agentRes.status !== 200) {
    throw new Error(`[overlord-mcp] Agent token exchange failed: ${agentRes.status}`);
  }

  const agentToken = agentRes.data.access_token;
  saveToken(agentToken);
  console.error(`[overlord-mcp] Agent token obtained and saved to ${TOKEN_FILE}`);

  return agentToken;
}

function startRedirectServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const code = url.searchParams.get('code');

      if (code && server.onCallback) {
        server.onCallback(code);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <head><title>Authorization Successful</title></head>
            <body style="font-family: Arial; text-align: center; margin-top: 50px;">
              <h1>✓ Authorization Successful</h1>
              <p>You can now close this window and return to Claude Code.</p>
            </body>
          </html>
        `);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: address.port,
        close: () => server.close(),
        onCallback: null
      });
    });
  });
}

// ============================================================================
// MCP Protocol Implementation
// ============================================================================

class OverlordMCPClient {
  constructor(baseUrl, agentToken) {
    this.baseUrl = baseUrl;
    this.agentToken = agentToken;
    this.requestId = 1;
  }

  async call(method, params = {}) {
    const id = this.requestId++;
    const requestBody = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    const res = await fetch(`${this.baseUrl}/functions/v1/mcp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.agentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (res.status !== 200) {
      throw new Error(`MCP call failed: ${res.status} ${res.data}`);
    }

    const result = res.data;
    if (result.error) {
      throw new Error(`MCP error: ${result.error.message}`);
    }

    return result.result;
  }

  async initialize() {
    return this.call('initialize', {});
  }

  async listTools() {
    return this.call('tools/list', {});
  }

  async callTool(name, args) {
    return this.call('tools/call', { name, arguments: args });
  }

  async attach(ticketId, agentIdentifier = 'claude-code') {
    return this.callTool('attach', { ticketId, agentIdentifier, connectionMethod: 'mcp' });
  }

  async update(sessionKey, ticketId, summary, phase = 'execute') {
    return this.callTool('update', { sessionKey, ticketId, summary, phase });
  }

  async deliver(sessionKey, ticketId, summary, artifacts = []) {
    return this.callTool('deliver', { sessionKey, ticketId, summary, artifacts });
  }

  async ask(sessionKey, ticketId, question) {
    return this.callTool('ask', { sessionKey, ticketId, question });
  }

  async readContext(sessionKey, ticketId, query = null) {
    return this.callTool('read_context', { sessionKey, ticketId, query });
  }

  async writeContext(sessionKey, ticketId, key, value) {
    return this.callTool('write_context', { sessionKey, ticketId, key, value });
  }

  async createTicket(sessionKey, ticketId, title, objective, executionTarget = 'agent', priority = 'medium') {
    return this.callTool('create_ticket', { sessionKey, ticketId, title, objective, executionTarget, priority });
  }
}

// ============================================================================
// MCP Server for Claude Code
// ============================================================================

async function main() {
  const agentToken = await authenticate();
  const client = new OverlordMCPClient(OVERLORD_URL, agentToken);

  await client.initialize();
  const tools = await client.listTools();

  console.log(JSON.stringify({
    server: {
      capabilities: {
        tools: {}
      },
      tools: tools.tools || []
    }
  }));
}

main().catch(err => {
  console.error('[overlord-mcp] Error:', err.message);
  process.exit(1);
});
```

### 3. Test the Connection

Once configured, test that Claude Code can connect:

```bash
# Initialize Claude Code with MCP
npx @claude-code/cli --mcp overlord

# Or in an existing Claude Code session, use the /mcp command to list available tools
```

## Usage in Claude Code

Once the MCP is configured, you can use it directly in Claude Code sessions:

### Example: Attach to a Ticket

```
/mcp attach --ticket-id c7b49550-cf4b-4fd3-9926-34794e69c5a6
```

### Example: Post an Update

```
/mcp update --session-key <sessionKey> --ticket-id <ticketId> --summary "Completed initial analysis" --phase execute
```

### Example: Deliver Work

```
/mcp deliver --session-key <sessionKey> --ticket-id <ticketId> --summary "Feature implemented and tested" --artifacts-json '[{"type":"file_changes","label":"Files modified","content":"- src/app.ts\n- src/utils.ts"}]'
```

## Advanced Configuration

### Using Environment Variables

Instead of hardcoding in MCP config, set environment variables:

```bash
export OVERLORD_URL=https://ovld.ai
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_OAUTH_CLIENT_ID=577e4468-a806-489e-8b99-206471e7442c
export SUPABASE_OAUTH_REDIRECT_URI=http://127.0.0.1:3000/callback
```

Then the MCP server will automatically pick them up.

### Persistent Token Storage

The MCP client automatically saves tokens to `~/.overlord-agent-token` with restricted permissions (mode 0600). To clear the stored token:

```bash
rm ~/.overlord-agent-token
```

On next use, it will trigger a new OAuth flow.

### Custom Redirect Port

If port 3000 is in use, set a custom redirect URI:

```json
{
  "mcp_servers": {
    "overlord": {
      "env": {
        "SUPABASE_OAUTH_REDIRECT_URI": "http://127.0.0.1:8765/callback"
      }
    }
  }
}
```

## Troubleshooting

### Token Exchange Fails with "OAuth token required (missing client_id claim)"

**Problem**: The Supabase JWT doesn't have a `client_id` claim.

**Solution**: Ensure the Supabase project is configured with the correct OAuth client. The `client_id` is set during the OAuth flow when the user authorizes with Supabase.

### "No organization found" Error

**Problem**: User authenticated but doesn't have an organization membership.

**Solution**: Complete onboarding on the Overlord platform first to create/join an organization.

### Port Already in Use

**Problem**: The redirect server can't bind to the default port.

**Solution**: The client automatically picks an available port. If a specific port is needed, set `SUPABASE_OAUTH_REDIRECT_URI` to the desired port and register it in Supabase OAuth clients.

### MCP Functions Not Available

**Problem**: MCP tools don't show up in Claude Code.

**Solution**:
1. Verify the MCP server script is executable
2. Check that authentication succeeded (no error on startup)
3. Run `/mcp ping` to test connectivity
4. Check Claude Code logs for errors

## Example Workflow

Here's a complete workflow using Claude Code with the Overlord MCP:

```
1. $ claude-code
2. > I want to work on ticket c7b49550-cf4b-4fd3-9926-34794e69c5a6

3. [MCP Auto-authenticates]
4. > /mcp attach --ticket-id c7b49550-cf4b-4fd3-9926-34794e69c5a6

5. [Claude Code receives session key and ticket details]
6. > [Claude Code reads ticket objective and starts working]

7. > [After 30 minutes of work] /mcp update --summary "Completed initial design review. Creating implementation plan." --phase execute

8. > [After completing work] /mcp deliver --summary "Implemented MCP auth flow with OAuth 2.0 PKCE" --artifacts-json '[...]'

9. [Ticket moves to review status]
```

## Files Reference

| File | Purpose |
|------|---------|
| `~/.claude/settings.json` | Claude Code MCP server configuration |
| `./mcp-client.js` | MCP client implementation |
| `~/.overlord-agent-token` | Stored agent token (do not commit) |
| `docs/MCP_AUTH_AND_INTEGRATION.md` | Complete authentication guide |
| `docs/MCP_SETUP.md` | MCP service setup reference |
| `supabase/functions/mcp/index.ts` | MCP server implementation |

## Next Steps

1. Copy the MCP client script to your project
2. Update `.claude/settings.json` with your Overlord URL and OAuth client ID
3. Run `claude-code` and test with `/mcp ping`
4. Use `/mcp attach` to connect to a ticket
5. Refer to `docs/MCP_AUTH_AND_INTEGRATION.md` for complete API documentation
