# MCP Service Setup & Configuration

## Current Implementation Status

The MCP service at `supabase/functions/mcp/index.ts` is **ready for OAuth authentication**. It already:

✅ Validates bearer tokens from `agent_tokens` table
✅ Implements JSON-RPC 2.0 protocol for MCP communication
✅ Exposes Overlord protocol tools (attach, update, deliver, ask, etc.)
✅ Handles authentication via `resolveToken()` function
✅ Supports all MCP lifecycle methods (initialize, ping, tools/list, tools/call)

## OAuth Integration (No Code Changes Needed)

The MCP authentication flow is **already complete** and uses the existing OAuth infrastructure:

1. **Client discovers OAuth config** → `GET /api/auth/config`
2. **Client authenticates with Supabase** → Supabase OAuth endpoint
3. **Client exchanges Supabase JWT for agent token** → `POST /api/auth/token`
4. **Client calls MCP with agent token** → `POST /functions/v1/mcp` with `Authorization: Bearer <token>`

The MCP validates the bearer token against the `agent_tokens` table automatically.

## Configuration Checklist

### Environment Variables (Required)

The following must be set in `.env.local` for the platform:

```bash
# Overlord Platform
OVERLORD_URL=https://overlord.cooperativ.io
SUPABASE_URL=https://your-project.supabase.co

# OAuth Client IDs (from Supabase auth.oauth_clients table)
SUPABASE_OAUTH_CLI_CLIENT_ID=577e4468-a806-489e-8b99-206471e7442c
SUPABASE_OAUTH_ELECTRON_CLIENT_ID=f9a4c58c-68c7-4a20-88f9-2a2dc3eed88e

# OAuth Redirect URIs
SUPABASE_OAUTH_CLI_REDIRECT_URI=http://127.0.0.1:3000/callback
SUPABASE_OAUTH_ELECTRON_REDIRECT_URI=http://127.0.0.1:3000/callback

# Supabase
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
SUPABASE_ANON_KEY=<your-anon-key>
```

### Database Setup (Already Configured)

The following tables are **already created** and properly configured:

#### `agent_tokens` Table

```sql
CREATE TABLE agent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  organization_id integer NOT NULL REFERENCES organizations(id),
  token text NOT NULL UNIQUE,
  name text,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_by_grant_id uuid REFERENCES auth_grants(id),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_tokens_token_idx ON agent_tokens(token);
CREATE INDEX agent_tokens_user_id_idx ON agent_tokens(user_id);
CREATE INDEX agent_tokens_organization_id_idx ON agent_tokens(organization_id);
```

#### `auth_grants` Table

Manages OAuth authorization grants for device/browser flows:

```sql
CREATE TABLE auth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_code text NOT NULL UNIQUE,
  user_code text NOT NULL UNIQUE,
  client_type text NOT NULL CHECK (client_type IN ('cli', 'electron')),
  client_name text,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  consumed_at timestamptz,
  user_id uuid REFERENCES auth.users(id),
  agent_token_id uuid REFERENCES agent_tokens(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_grants_grant_code_idx ON auth_grants(grant_code);
```

#### `auth.oauth_clients` Table (Supabase)

OAuth clients are defined in Supabase's native `auth.oauth_clients` table:

```sql
-- CLI Client
INSERT INTO auth.oauth_clients (
  id, client_name, client_type, grant_types,
  redirect_uris, registration_type, token_endpoint_auth_method
) VALUES (
  '577e4468-a806-489e-8b99-206471e7442c',
  'Overlord CLI',
  'public',
  'authorization_code',
  'http://127.0.0.1:3000/callback',
  'manual',
  'none'
);

-- Electron Client
INSERT INTO auth.oauth_clients (
  id, client_name, client_type, grant_types,
  redirect_uris, registration_type, token_endpoint_auth_method
) VALUES (
  'f9a4c58c-68c7-4a20-88f9-2a2dc3eed88e',
  'Overlord Electron',
  'public',
  'authorization_code',
  'http://127.0.0.1:3000/callback',
  'manual',
  'none'
);
```

### API Endpoints (Already Implemented)

| Endpoint | Purpose | Auth | Status |
|----------|---------|------|--------|
| `GET /api/auth/config` | Discover OAuth configuration | None | ✅ Complete |
| `POST /api/auth/device/request` | Initiate device/browser auth | None | ✅ Complete |
| `POST /api/auth/device/poll` | Poll for device auth completion | None | ✅ Complete |
| `POST /api/auth/token` | Exchange Supabase JWT for agent token | Bearer (Supabase JWT) | ✅ Complete |
| `POST /functions/v1/mcp` | MCP service endpoint | Bearer (agent token) | ✅ Complete |

### MCP Handler Functions (Already Implemented)

All MCP tools are implemented in `supabase/functions/mcp/handlers/`:

- `attach.ts` — Initialize session and load ticket
- `update.ts` — Post progress updates
- `ask.ts` — Post blocking questions
- `deliver.ts` — Deliver final results
- `read_context.ts` — Read shared context
- `write_context.ts` — Write shared context
- `create_ticket.ts` — Create follow-up tickets
- `artifact_prepare_upload.ts` — Prepare file upload
- `artifact_finalize_upload.ts` — Finalize file upload
- `artifact_get_download_url.ts` — Get file download URL

## Adding a New OAuth Client Type

To add support for a new client type (e.g., "mcp-server"):

### 1. Create OAuth Client in Supabase

```sql
INSERT INTO auth.oauth_clients (
  id, client_name, client_type, grant_types,
  redirect_uris, registration_type, token_endpoint_auth_method
) VALUES (
  gen_random_uuid(),
  'Overlord MCP Server',
  'public',
  'authorization_code',
  'http://localhost:8080/callback',
  'manual',
  'none'
);
```

### 2. Add Environment Variables

```bash
SUPABASE_OAUTH_MCP_CLIENT_ID=<client-id-from-above>
SUPABASE_OAUTH_MCP_REDIRECT_URI=http://localhost:8080/callback
```

### 3. Update `/api/auth/config` (Optional)

If you want the new client to be discoverable, update `app/api/auth/config/route.ts`:

```typescript
const mcpClientId = process.env.SUPABASE_OAUTH_MCP_CLIENT_ID;
const mcpRedirectUri = process.env.SUPABASE_OAUTH_MCP_REDIRECT_URI;

return NextResponse.json({
  supabase_url: supabaseUrl,
  cli_client_id: cliClientId ?? null,
  electron_client_id: electronClientId ?? null,
  mcp_client_id: mcpClientId ?? null,
  // ... redirect URIs
});
```

### 4. Update `/api/auth/token` (If Needed)

The token endpoint already supports any client with an `agent_tokens` entry, so no changes needed unless you want to restrict clients.

## Testing the MCP OAuth Flow

### Manual Test (Curl)

```bash
#!/bin/bash
set -e

OVERLORD_URL="http://localhost:3000"
SUPABASE_URL="http://127.0.0.1:54321"

# Step 1: Get config
echo "1. Fetching auth config..."
CONFIG=$(curl -s "$OVERLORD_URL/api/auth/config")
echo "$CONFIG" | jq .

# Step 2: Generate PKCE
echo "2. Generating PKCE challenge..."
CODE_VERIFIER=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=')
echo "Code verifier: $CODE_VERIFIER"
echo "Code challenge: $CODE_CHALLENGE"

# Step 3: Simulate OAuth (use test user credentials in local Supabase)
echo "3. Getting Supabase JWT (using test credentials)..."
JWT=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jake@c.com",
    "password": "test123",
    "gotrue_meta_security": {}
  }' | jq -r '.access_token')
echo "JWT: $JWT"

# Step 4: Exchange for agent token
echo "4. Exchanging JWT for agent token..."
AGENT_TOKEN=$(curl -s -X POST "$OVERLORD_URL/api/auth/token" \
  -H "Authorization: Bearer $JWT" | jq -r '.access_token')
echo "Agent Token: $AGENT_TOKEN"

# Step 5: Test MCP
echo "5. Testing MCP with agent token..."
curl -s -X POST "$OVERLORD_URL/functions/v1/mcp" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id": 1, "method": "initialize", "params": {}}' | jq .
```

### Node.js Test Client

```typescript
// test-mcp-auth.ts
import { createClient } from '@supabase/supabase-js';

const OVERLORD_URL = 'http://localhost:3000';
const SUPABASE_URL = 'http://127.0.0.1:54321';

async function testMCPAuth() {
  // Step 1: Get config
  console.log('1. Getting OAuth config...');
  const configRes = await fetch(`${OVERLORD_URL}/api/auth/config`);
  const config = await configRes.json();
  console.log('Config:', config);

  // Step 2: Authenticate with Supabase (local test)
  console.log('2. Authenticating with Supabase...');
  const supabase = createClient(SUPABASE_URL, config.cli_client_id);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'jake@c.com',
    password: 'test123'
  });

  if (error) throw error;
  const supabaseJwt = data.session?.access_token;
  console.log('Supabase JWT obtained');

  // Step 3: Exchange for agent token
  console.log('3. Exchanging for agent token...');
  const tokenRes = await fetch(`${OVERLORD_URL}/api/auth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseJwt}`
    }
  });
  const tokenData = await tokenRes.json();
  const agentToken = tokenData.access_token;
  console.log('Agent Token:', agentToken);

  // Step 4: Call MCP
  console.log('4. Calling MCP...');
  const mcpRes = await fetch(`${OVERLORD_URL}/functions/v1/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agentToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: 1,
      method: 'initialize',
      params: {}
    })
  });

  const result = await mcpRes.json();
  console.log('MCP Response:', result);
}

testMCPAuth().catch(console.error);
```

## Deployment Checklist

### Local Development
- [ ] `.env.local` has all required variables
- [ ] Supabase local instance is running
- [ ] Edge function is deployed locally (`supabase functions deploy mcp`)
- [ ] OAuth clients are seeded in local Supabase
- [ ] Test OAuth flow works end-to-end

### Staging
- [ ] Environment variables set in hosting platform (Vercel, etc.)
- [ ] Supabase OAuth clients created with staging URLs
- [ ] Edge functions deployed to Supabase staging project
- [ ] Token exchange endpoint returns valid agent tokens
- [ ] MCP accepts tokens and processes requests

### Production
- [ ] Environment variables set with production URLs
- [ ] OAuth clients created in production Supabase
- [ ] All endpoints using HTTPS
- [ ] Rate limiting configured on OAuth endpoints
- [ ] Monitoring/alerting for authentication failures
- [ ] Documentation updated with production URLs

## Troubleshooting Deployment

### MCP Returns 401 Unauthorized

```
Check:
1. Token is present: curl -H "Authorization: Bearer $TOKEN" ...
2. Token is in agent_tokens table
3. Token.revoked_at IS NULL
4. Token.expires_at > NOW()
5. Token's organization matches request organization
```

### OAuth Flow Hangs at Browser Redirect

```
Check:
1. OAuth client registered in auth.oauth_clients
2. SUPABASE_OAUTH_*_CLIENT_ID matches registered ID
3. SUPABASE_OAUTH_*_REDIRECT_URI matches registered redirect_uri
4. Redirect URI is accessible (correct port, not blocked by firewall)
```

### Agent Token Exchange Returns 403

```
Check:
1. Supabase JWT is valid (not expired)
2. JWT has valid client_id claim
3. Client ID is in allowedClientIds in /api/auth/token
4. User exists and has organization membership
```

## Architecture Diagram

```
┌────────────────┐
│  Claude Code   │
│   (Desktop)    │
└────────┬────────┘
         │
         ├─(1) GET /api/auth/config
         │
         ├─(2) Redirect to Supabase OAuth
         │     https://project.supabase.co/auth/v1/authorize
         │
         ├─(3) User authorizes, gets auth_code
         │
         ├─(4) POST /auth/v1/token → Supabase JWT
         │
         ├─(5) POST /api/auth/token → Agent Token
         │
         └─(6) POST /functions/v1/mcp (with Agent Token)
              │
              └─→ ┌──────────────────┐
                  │  MCP Server      │
                  │  Edge Function   │
                  └──────────────────┘
                         │
                         ├─ Validates bearer token
                         ├─ Checks agent_tokens table
                         ├─ Calls handler (attach, update, etc.)
                         └─ Returns MCP result (JSON-RPC)
```

## References

- **MCP Service**: `supabase/functions/mcp/index.ts`
- **Auth Logic**: `supabase/functions/mcp/auth.ts`
- **Token Exchange**: `app/api/auth/token/route.ts`
- **OAuth Config Discovery**: `app/api/auth/config/route.ts`
- **Database Schema**: `supabase/migrations/20260302120000_auth-grants.sql`
- **Documentation**: `docs/MCP_AUTH_AND_INTEGRATION.md`
