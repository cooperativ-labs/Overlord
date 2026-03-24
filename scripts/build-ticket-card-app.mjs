/**
 * Reads the Sunpeak-built ticket-card HTML and metadata from
 * mcp-apps/ticket-card/dist/ and generates the edge function resource file
 * at supabase/functions/mcp/ui/ticket-card-resource.ts.
 *
 * Run after `yarn sunpeak:ticket-card:build`:
 *   node scripts/build-ticket-card-app.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const distDir = path.join(repoRoot, 'mcp-apps/ticket-card/dist/ticket-card');
const outputFile = path.join(repoRoot, 'supabase/functions/mcp/ui/ticket-card-resource.ts');

// Stable URI used by tool metadata in tools.ts — do not change.
const STABLE_URI = 'ui://overlord/ticket-card';

const html = await readFile(path.join(distDir, 'ticket-card.html'), 'utf8');
const meta = JSON.parse(await readFile(path.join(distDir, 'ticket-card.json'), 'utf8'));

const mimeType = meta.mimeType ?? 'text/html;profile=mcp-app';
const title = meta.title ?? 'Overlord Ticket Card';
const description =
  meta.description ?? 'Review and edit a drafted Overlord ticket before saving it from chat.';
const metaBlock = meta._meta ?? {};

const fileContents = `export const TICKET_CARD_RESOURCE_URI = ${JSON.stringify(STABLE_URI)};
export const TICKET_CARD_MIME_TYPE = ${JSON.stringify(mimeType)};
export const TICKET_CARD_TITLE = ${JSON.stringify(title)};
export const TICKET_CARD_DESCRIPTION = ${JSON.stringify(description)};
export const TICKET_CARD_META: Record<string, unknown> = ${JSON.stringify(metaBlock, null, 2)};
export const TICKET_CARD_HTML = ${JSON.stringify(html)};
`;

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, fileContents, 'utf8');

const sizeKb = (Buffer.byteLength(fileContents, 'utf8') / 1024).toFixed(1);
process.stdout.write(
  `Wrote ${path.relative(repoRoot, outputFile)} (${sizeKb} KB, sunpeak uri: ${meta.uri})\n`
);
