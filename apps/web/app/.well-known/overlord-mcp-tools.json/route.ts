import {
  buildPublicToolsCatalogResponse,
  PUBLIC_TOOLS_CATALOG_CORS_HEADERS
} from '@/lib/mcp/public-tools-catalog';

export const dynamic = 'force-static';

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_TOOLS_CATALOG_CORS_HEADERS });
}

export function GET() {
  return buildPublicToolsCatalogResponse();
}
