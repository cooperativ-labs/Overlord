import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Product Surfaces'
};

export default function SurfacesPage() {
  return (
    <DocsMarkdownPage
      title="Product Surfaces"
      lead="Overlord keeps the workflow centered on tickets, then lets you work through whichever surface makes the most sense for the task."
    >
      {`
## The four surfaces

Overlord is made of four user-facing pieces:

### Web app

The main shared workspace for projects, tickets, activity, artifacts, and account settings.

### Electron desktop app

A thin local wrapper around the web app that adds local terminal access, repository linking, and desktop-specific capabilities.

### CLI

The terminal interface used by agents and humans to attach to tickets, stream updates, ask questions, and deliver results.

### MCP server

The cloud-facing integration surface that lets hosted or remote agents work with the same tickets and protocol.

## Why this split matters

Overlord does not ask you to move all agent work into one new UI. It keeps the work organized in tickets while letting each surface do the job it is best at.

## What to read next

- [Web app](/docs/surfaces/web-app)
- [Desktop app](/docs/surfaces/desktop-app)
- [CLI](/docs/surfaces/cli)
- [MCP server](/docs/surfaces/mcp-server)
      `}
    </DocsMarkdownPage>
  );
}
