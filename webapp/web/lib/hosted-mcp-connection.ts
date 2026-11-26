export type HostedMcpConnection = {
  mcpUrl: string;
  authorizationUrl: string;
};

type ProtectedResourceMetadata = {
  resource?: unknown;
  authorization_servers?: unknown;
};

function normalizedUrl(value: unknown, label: string): URL {
  if (typeof value !== 'string') throw new Error(`MCP discovery omitted ${label}.`);
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`MCP discovery returned an invalid ${label}.`);
  }
  return url;
}

export async function readHostedMcpConnection(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch
): Promise<HostedMcpConnection> {
  const response = await fetcher(
    `${apiBaseUrl.replace(/\/+$/, '')}/.well-known/oauth-protected-resource/mcp`
  );
  if (!response.ok) throw new Error(`MCP discovery failed with HTTP ${response.status}.`);

  const metadata = (await response.json()) as ProtectedResourceMetadata;
  const resource = normalizedUrl(metadata.resource, 'resource URL');
  if (!resource.pathname.replace(/\/+$/, '').endsWith('/mcp')) {
    throw new Error('MCP discovery returned a resource URL without the /mcp path.');
  }
  if (!Array.isArray(metadata.authorization_servers) || metadata.authorization_servers.length < 1) {
    throw new Error('MCP discovery omitted its authorization server.');
  }
  const issuer = normalizedUrl(metadata.authorization_servers[0], 'authorization server');

  return {
    mcpUrl: resource.toString().replace(/\/$/, ''),
    authorizationUrl: `${issuer.toString().replace(/\/$/, '')}/oauth/approve`
  };
}
