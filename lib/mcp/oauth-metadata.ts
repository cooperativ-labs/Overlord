import { getPlatformUrl, getSupabaseUrl } from '@/lib/env';

export const MCP_RESOURCE_PATH = '/api/mcp';
export const MCP_RESOURCE_METADATA_PATH = '/api/mcp/.well-known/oauth-protected-resource';

type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
};

export function buildProtectedResourceMetadata(resource: string): ProtectedResourceMetadata {
  return {
    resource,
    authorization_servers: [`${getSupabaseUrl()}/auth/v1`],
    scopes_supported: ['openid', 'email', 'profile'],
    bearer_methods_supported: ['header']
  };
}

export function buildAppMcpProtectedResourceMetadata(providedUrl?: string | null) {
  const resourceUrl = new URL(MCP_RESOURCE_PATH, getPlatformUrl(providedUrl)).toString();
  return buildProtectedResourceMetadata(resourceUrl);
}

export function getAppMcpResourceMetadataUrl(providedUrl?: string | null): string {
  return new URL(MCP_RESOURCE_METADATA_PATH, getPlatformUrl(providedUrl)).toString();
}

export function rewriteBearerResourceMetadata(
  challenge: string | null,
  resourceMetadataUrl: string
): string {
  const resourceMetadataParam = `resource_metadata="${resourceMetadataUrl}"`;

  if (!challenge) {
    return `Bearer ${resourceMetadataParam}`;
  }

  if (!/^Bearer\b/i.test(challenge)) {
    return challenge;
  }

  if (/resource_metadata="[^"]*"/i.test(challenge)) {
    return challenge.replace(/resource_metadata="[^"]*"/i, resourceMetadataParam);
  }

  return `${challenge}, ${resourceMetadataParam}`;
}
