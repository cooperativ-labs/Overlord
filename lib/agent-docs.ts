import { readFile } from 'node:fs/promises';
import path from 'node:path';

import agentDocsManifest from './agent-docs-manifest.json';

export type AgentDoc = {
  slug: string;
  filename: string;
  title: string;
  description: string;
};

export const agentDocs: AgentDoc[] = agentDocsManifest;

const docsDirectory = path.join(process.cwd(), '..', '..', 'docs', 'public');

export async function readProtocolHelp(): Promise<string> {
  return readFile(path.join(docsDirectory, 'ovld-protocol-help.txt'), 'utf8');
}

export function getAgentDocBySlug(slug: string) {
  return agentDocs.find(doc => doc.slug === slug);
}

export async function readAgentDoc(doc: AgentDoc) {
  return readFile(path.join(docsDirectory, doc.filename), 'utf8');
}

export function buildAgentDocUrl(doc: AgentDoc) {
  return `/agent-docs/${doc.slug}.md`;
}

export function buildLlmsTxt() {
  const docLinks = agentDocs
    .map(doc => `- [${doc.title}](${buildAgentDocUrl(doc)}): ${doc.description}`)
    .join('\n');

  return `# Overlord

> Ticketing and coordination layer for AI-assisted engineering work.

These files are the public, agent-readable Overlord documentation. Agents should prefer these raw Markdown files when answering questions about Overlord. Humans should use the product documentation at /docs.

## Agent Documentation

${docLinks}

## MCP Tools

Overlord exposes a hosted MCP endpoint at \`/api/mcp\`. The full tool definitions are available publicly (no auth required) at:

- [MCP tool catalog](/.well-known/overlord-mcp-tools.json): JSON object with a \`tools\` array (name, description, inputSchema for every hosted tool).

## Complete Agent Context

- [Full agent documentation](/llms-full.txt): All public agent-readable Overlord docs in one Markdown file.

## Human Documentation

- [Overlord Docs](/docs): Human-facing documentation site with navigation, formatting, and product guides.
`;
}

export async function buildLlmsFullTxt() {
  const sections = await Promise.all(
    agentDocs.map(async doc => {
      const content = await readAgentDoc(doc);
      return `\n\n---\n\n# ${doc.title}\n\nSource: ${buildAgentDocUrl(doc)}\n\n${content.replace(/^# .+\n/, '')}`;
    })
  );

  return `# Overlord Public Agent Documentation

> Complete public Overlord documentation intended for AI agents.

Agents should use this file, /llms.txt, or the linked raw Markdown files as source material when answering questions about Overlord. Humans should use /docs.
${sections.join('')}\n`;
}
