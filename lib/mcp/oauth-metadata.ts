import { getPlatformUrl, getSupabaseUrl } from '@/lib/env';
import { getAppMcpToolCatalogUrl, MCP_TOOL_CATALOG_PATH } from '@/lib/mcp/public-tools-catalog';

export const MCP_RESOURCE_PATH = '/api/mcp';
export const MCP_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/api/mcp';
export const MCP_RESOURCE_METADATA_LEGACY_PATH = '/api/mcp/.well-known/oauth-protected-resource';

export type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  /** Machine-readable MCP tool schemas (public, no auth). */
  tool_catalog: string;
  /** Human-readable agent documentation. */
  resource_documentation: string;
};

export function buildProtectedResourceMetadata({
  resource,
  platformUrl
}: {
  resource: string;
  platformUrl: string;
}): ProtectedResourceMetadata {
  const origin = new URL(platformUrl).origin;

  return {
    resource,
    authorization_servers: [`${getSupabaseUrl()}/auth/v1`],
    scopes_supported: ['openid', 'email', 'profile'],
    bearer_methods_supported: ['header'],
    tool_catalog: getAppMcpToolCatalogUrl(origin),
    resource_documentation: new URL('/agent-docs', origin).toString()
  };
}

export function buildAppMcpProtectedResourceMetadata(providedUrl?: string | null) {
  const platformUrl = getPlatformUrl(providedUrl);
  const resourceUrl = new URL(MCP_RESOURCE_PATH, platformUrl).toString();

  return buildProtectedResourceMetadata({ resource: resourceUrl, platformUrl });
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

export { MCP_TOOL_CATALOG_PATH };
