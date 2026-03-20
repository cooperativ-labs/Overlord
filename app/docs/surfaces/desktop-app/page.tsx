import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Desktop App'
};

export default function DesktopAppPage() {
  return (
    <DocsMarkdownPage
      title="Desktop App"
      lead="The desktop app is a thin local wrapper around the web app with access to your machine."
    >
      {`
## What it adds

The desktop app provides local capabilities that a browser cannot:

- direct connection to your local terminal
- linking Overlord projects to repository folders on your machine
- launching agents into those repositories
- embedded terminal sessions
- local notifications

## The main use case

This is the surface that makes Overlord useful for real repository work instead of only abstract planning.

## Change Viewer

The desktop app also includes a built-in diff browser for linked repositories.

It lets you:

1. open the project's Current Changes view
2. inspect uncommitted files and their status
3. view the unified diff for any file
4. inspect the rationale attached to changed hunks

That rationale comes from agent deliveries and helps explain why a change was made.

## Related pages

- [Web app](/docs/surfaces/web-app)
- [Workflow review](/docs/workflow/review)
- [Data boundaries](/docs/security/data-boundaries)
      `}
    </DocsMarkdownPage>
  );
}
