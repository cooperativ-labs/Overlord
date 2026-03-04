# MCP Authentication & Client Integration Guide

## Overview

The Overlord MCP (Model Context Protocol) server enables cloud-based agents and CLI tools to interact with the Overlord ticket system. Authentication is handled through bearer tokens that are obtained via an OAuth 2.0 flow.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Client (Claude Code, Codex, etc.)        │
│                                                               │
│  1. Discovers OAuth config from /api/auth/config            │
│  2. Initiates OAuth flow with Supabase                       │
│  3. Receives Supabase access token (JWT)                     │
│  4. Exchanges JWT for long-lived agent token at /api/auth/token │
│  5. Uses agent token with MCP at /functions/mcp              │
└─────────────────────────────────────────────────────────────┘
              ↓              ↓              ↓
       ┌──────────┐   ┌──────────┐   ┌──────────┐
       │Supabase  │   │ Overlord │   │   MCP    │
       │Auth      │   │   API    │   │  Server  │
       │(OAuth)   │   │(Exchange)│   │(Ticket   │
       └──────────┘   └──────────┘   │ Protocol)│
                                      └──────────┘
```

## Authentication Flow

### Step 1: Discover Configuration

Fetch the public OAuth configuration from the Overlord platform:

```bash
GET /api/auth/config

Response:
{
  "supabase_url": "https://example.supabase.co",
  "cli_client_id": "577e4468-a806-489e-8b99-206471e7442c",
  "cli_redirect_uri": "http://127.0.0.1:3000/callback",
  "electron_client_id": "f9a4c58c-68c7-4a20-88f9-2a2dc3eed88e",
  "electron_redirect_uri": "http://127.0.0.1:3000/callback"
}
```

### Step 2: OAuth 2.0 Code Exchange (PKCE Flow)

Use Supabase's OAuth endpoints to authenticate the user:

```bash
# 1. Generate code verifier and challenge
code_verifier=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
code_challenge=$(echo -n "$code_verifier" | sha256sum | base64 -w0 | tr '+/' '-_' | tr -d '=')

# 2. Redirect user to Supabase authorization endpoint
https://{SUPABASE_URL}/auth/v1/authorize?
  client_id={CLI_CLIENT_ID}
  &response_type=code
  &redirect_uri={REDIRECT_URI}
  &scope=openid%20profile%20email
  &code_challenge={code_challenge}
  &code_challenge_method=S256

# 3. User logs in and authorizes → redirected to http://127.0.0.1:3000/callback?code={auth_code}&state={state}

# 4. Exchange authorization code for access token
curl -X POST https://{SUPABASE_URL}/auth/v1/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "code": "{auth_code}",
    "client_id": "{CLI_CLIENT_ID}",
    "redirect_uri": "{REDIRECT_URI}",
    "code_verifier": "{code_verifier}"
  }'

Response:
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "...",
  "user": { ... }
}
```

### Step 3: Exchange for Overlord Agent Token

With the Supabase JWT (access_token), exchange it for a long-lived Overlord agent token:

```bash
curl -X POST https://overlord.platform.url/api/auth/token \
  -H "Authorization: Bearer {SUPABASE_ACCESS_TOKEN}"

Response:
{
  "access_token": "agent_token_xyz...",
  "platform_url": "https://overlord.platform.url"
}
```

### Step 4: Authenticate with MCP

Use the agent token with all MCP requests:

```bash
curl -X POST https://overlord.platform.url/functions/v1/mcp \
  -H "Authorization: Bearer {AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

## MCP Authentication Details

The MCP server validates bearer tokens against the `agent_tokens` table:

```typescript
// Token validation in /supabase/functions/mcp/auth.ts
export async function resolveToken(req: Request, supabase: SupabaseClient) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  const { data } = await supabase
    .from('agent_tokens')
    .select('id, user_id, organization_id, token, revoked_at, expires_at')
    .eq('token', token)
    .single();

  // Token is valid if:
  // - Found in database
  // - Not revoked (revoked_at IS NULL)
  // - Not expired (expires_at > now)

  return {
    userId: data.user_id,
    organizationId: data.organization_id,
    tokenId: data.id,
    tokenValue: token
  };
}
```

## Client Integration Instructions

### Claude Code (Desktop/CLI)

Claude Code can connect to the MCP via the `@supabase/functions/mcp/index.ts` endpoint.

#### Configuration

Add to your Claude Code settings or initialization:

```json
{
  "mcp_servers": {
    "overlord": {
      "command": "node",
      "args": ["overlord-mcp-client.js"],
      "env": {
        "OVERLORD_URL": "https://overlord.platform.url",
        "SUPABASE_URL": "https://project.supabase.co",
        "SUPABASE_OAUTH_CLIENT_ID": "577e4468-a806-489e-8b99-206471e7442c",
        "SUPABASE_OAUTH_REDIRECT_URI": "http://127.0.0.1:3000/callback"
      }
    }
  }
}
```

#### Authentication Steps

1. **On first run**: Claude Code will detect missing `OVERLORD_AGENT_TOKEN`
2. **Fetch auth config**: Call `GET /api/auth/config` to get OAuth parameters
3. **Open browser**: Redirect user to Supabase OAuth flow
4. **Capture code**: Listen on local redirect URI for authorization code
5. **Exchange token**: POST to `/api/auth/token` with Supabase JWT
6. **Store token**: Save `access_token` to `~/.claude/overlord-token.json`
7. **Connect MCP**: Use token in all subsequent MCP requests

#### Example Implementation

```typescript
// overlord-mcp-client.ts
import { SupabaseClient } from '@supabase/supabase-js';

interface MCPToolCall {
  id: string | number;
  method: string;
  params?: Record<string, any>;
}

export async function authenticateWithOverlord() {
  // 1. Get OAuth config
  const configResponse = await fetch(`${OVERLORD_URL}/api/auth/config`);
  const config = await configResponse.json();

  // 2. Start OAuth flow with Supabase
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // 3. Open browser for user to authenticate
  const authUrl = new URL(`${config.supabase_url}/auth/v1/authorize`);
  authUrl.searchParams.set('client_id', config.cli_client_id);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', config.cli_redirect_uri);
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  // Open in browser...
  // User authorizes, gets redirected to localhost with code

  // 4. Exchange code for Supabase JWT
  const tokenResponse = await fetch(
    `${config.supabase_url}/auth/v1/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: authCode,
        client_id: config.cli_client_id,
        redirect_uri: config.cli_redirect_uri,
        code_verifier: codeVerifier
      })
    }
  );
  const { access_token: supabaseJwt } = await tokenResponse.json();

  // 5. Exchange Supabase JWT for Overlord agent token
  const agentTokenResponse = await fetch(`${OVERLORD_URL}/api/auth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseJwt}`
    }
  });
  const { access_token: agentToken } = await agentTokenResponse.json();

  return agentToken;
}

export async function callMCPTool(
  agentToken: string,
  toolCall: MCPToolCall
): Promise<any> {
  const response = await fetch(`${OVERLORD_URL}/functions/v1/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agentToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(toolCall)
  });

  return response.json();
}
```

### Codex in Cloud

Codex running in Vercel/Cloud requires slightly different configuration since it's running in a server environment.

#### Server-Side Authentication

```typescript
// pages/api/overlord-auth.ts - Exchange Supabase user JWT for agent token
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  // This is called from Codex with user's Supabase JWT in Authorization header
  const supabaseJwt = req.headers.get('authorization')?.replace('Bearer ', '');

  if (!supabaseJwt) {
    return NextResponse.json({ error: 'No Supabase JWT' }, { status: 401 });
  }

  // Exchange for agent token
  const response = await fetch(`${process.env.OVERLORD_URL}/api/auth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseJwt}`
    }
  });

  const { access_token, error } = await response.json();

  if (error) {
    return NextResponse.json({ error }, { status: response.status });
  }

  return NextResponse.json({ access_token });
}
```

#### MCP Configuration for Cloud Codex

```json
{
  "mcp_servers": {
    "overlord": {
      "url": "https://overlord.platform.url/functions/v1/mcp",
      "auth": {
        "type": "bearer",
        "token_url": "/api/overlord-auth",
        "supabase_client": true
      }
    }
  }
}
```

**Flow**:
1. Codex already has Supabase JWT from user authentication
2. Call `/api/overlord-auth` endpoint with Supabase JWT
3. Endpoint exchanges for agent token
4. Use agent token for all MCP requests

### Generic Agent/CLI Tool Implementation

For any agent or CLI tool, follow this generic pattern:

```bash
#!/bin/bash
set -e

OVERLORD_URL="${OVERLORD_URL:-https://overlord.platform.url}"
SUPABASE_URL=$(curl -s "$OVERLORD_URL/api/auth/config" | jq -r '.supabase_url')
CLIENT_ID=$(curl -s "$OVERLORD_URL/api/auth/config" | jq -r '.cli_client_id')
REDIRECT_URI=$(curl -s "$OVERLORD_URL/api/auth/config" | jq -r '.cli_redirect_uri')

# 1. Generate PKCE values
CODE_VERIFIER=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=')

# 2. Open browser for OAuth
AUTH_URL="$SUPABASE_URL/auth/v1/authorize?client_id=$CLIENT_ID&response_type=code&redirect_uri=$REDIRECT_URI&scope=openid%20profile%20email&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256"
echo "Opening: $AUTH_URL"
open "$AUTH_URL"  # or xdg-open on Linux

# 3. Listen for callback on local redirect URI
AUTH_CODE=$(node -e "
  const http = require('http');
  const { URL } = require('url');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost:3000');
    const code = url.searchParams.get('code');
    if (code) {
      res.writeHead(200);
      res.end('Authorization successful! You can close this window.');
      process.exit(0);
    }
  });
  server.listen(3000);
" 2>&1 || echo "")

# 4. Exchange code for Supabase JWT
TOKEN_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token" \
  -H "Content-Type: application/json" \
  -d "{
    \"grant_type\": \"authorization_code\",
    \"code\": \"$AUTH_CODE\",
    \"client_id\": \"$CLIENT_ID\",
    \"redirect_uri\": \"$REDIRECT_URI\",
    \"code_verifier\": \"$CODE_VERIFIER\"
  }")

SUPABASE_JWT=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token')

# 5. Exchange for Overlord agent token
AGENT_TOKEN=$(curl -s -X POST "$OVERLORD_URL/api/auth/token" \
  -H "Authorization: Bearer $SUPABASE_JWT" | jq -r '.access_token')

# 6. Save token
mkdir -p ~/.overlord
echo "$AGENT_TOKEN" > ~/.overlord/agent-token

echo "✓ Authenticated! Token saved to ~/.overlord/agent-token"
```

## Environment Variables

Configure the following environment variables on clients:

| Variable | Description | Example |
|----------|-------------|---------|
| `OVERLORD_URL` | Base URL of Overlord platform | `https://overlord.cooperativ.io` |
| `OVERLORD_AGENT_TOKEN` | Long-lived agent token (obtained via OAuth) | `agent_token_xyz...` |
| `SUPABASE_URL` | Supabase project URL (discovered via `/api/auth/config`) | `https://project.supabase.co` |
| `SUPABASE_OAUTH_CLIENT_ID` | OAuth client ID for your client type (discovered via `/api/auth/config`) | `577e4468-a806-489e-8b99-206471e7442c` |

## Token Management

### Token Lifecycle

- **Created**: Generated on first OAuth exchange at `/api/auth/token`
- **Reused**: Subsequent logins return existing active token (prevents token proliferation)
- **Expires**: Tokens can have optional `expires_at` timestamp
- **Revoked**: Can be manually revoked via `revoked_at` field
- **Tracked**: Last used time tracked in `last_used_at` field

### Storing Tokens Securely

**CLI/Desktop**:
- Store in `~/.{app}/credentials` file with mode `600`
- Use OS credential store (Keychain on macOS, Credential Manager on Windows)
- Never commit to version control

**Cloud/Server**:
- Store in environment variables or secure secret storage
- Use Vercel secrets, AWS Secrets Manager, etc.
- Rotate periodically

### Token Validation

The MCP validates tokens at request time:

```typescript
// Each request to MCP checks:
1. Token exists in agent_tokens table
2. revoked_at IS NULL (not revoked)
3. expires_at IS NULL OR expires_at > NOW (not expired)
4. User has membership in organization
5. Updates last_used_at timestamp
```

## Troubleshooting

### "Unauthorized: missing or invalid bearer token"

**Cause**: Token is missing, expired, revoked, or invalid

**Solutions**:
- Verify token is being sent in `Authorization: Bearer <token>` header
- Check if token `expires_at` timestamp has passed
- Verify token wasn't revoked in the database
- Re-authenticate to get a fresh token

### "OAuth token required (missing client_id claim)"

**Cause**: Token being exchanged is not a valid Supabase OAuth token

**Solutions**:
- Ensure you're exchanging the Supabase JWT, not an agent token
- Verify the JWT has a valid `client_id` claim in its payload
- Re-run OAuth flow to get a fresh Supabase token

### "No organization found. Please complete onboarding first."

**Cause**: User authenticated but hasn't joined an organization

**Solutions**:
- User must complete onboarding flow on the Overlord platform
- Add user to organization via admin panel
- Verify `members` table has a row for the user

## Security Considerations

1. **PKCE for Public Clients**: CLI and desktop apps must use PKCE flow (not client_secret)
2. **HTTPS Only**: All endpoints require HTTPS in production
3. **Token Expiration**: Set `expires_at` on tokens for sensitive environments
4. **Scope Limitation**: Tokens are scoped to a single organization
5. **Rate Limiting**: Implement rate limiting on OAuth endpoints to prevent brute force
6. **Token Rotation**: Consider implementing periodic token rotation for long-lived CLI tokens
7. **Audit Logging**: All token creation/revocation should be logged for compliance

## Implementation Checklist

- [ ] Review OAuth client IDs in `/api/auth/config`
- [ ] Ensure `SUPABASE_OAUTH_*` environment variables are set
- [ ] Test OAuth flow manually (browser → `/api/auth/config` → Supabase → `/api/auth/token`)
- [ ] Implement token storage in your client (encrypted, not in version control)
- [ ] Add token refresh logic for expired tokens
- [ ] Test MCP connection with valid agent token
- [ ] Set up monitoring for failed authentication attempts
- [ ] Document token rotation procedure for team
- [ ] Configure OAuth clients in Supabase admin panel if needed
