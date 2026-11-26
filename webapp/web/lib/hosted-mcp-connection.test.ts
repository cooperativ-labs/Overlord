import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readHostedMcpConnection } from './hosted-mcp-connection.ts';

describe('readHostedMcpConnection', () => {
  it('uses the resource and issuer returned by OAuth discovery', async () => {
    const connection = await readHostedMcpConnection('https://backend.example.test', async () =>
      Response.json({
        resource: 'https://app.example.test/mcp',
        authorization_servers: ['https://app.example.test']
      })
    );

    assert.deepEqual(connection, {
      mcpUrl: 'https://app.example.test/mcp',
      authorizationUrl: 'https://app.example.test/oauth/approve'
    });
  });

  it('rejects a resource that does not end in /mcp', async () => {
    await assert.rejects(
      readHostedMcpConnection('https://backend.example.test', async () =>
        Response.json({
          resource: 'https://app.example.test/',
          authorization_servers: ['https://app.example.test']
        })
      ),
      /without the \/mcp path/
    );
  });
});
