Ok # Implementation Plan - Update docs to explain how the runner works

We need to update the Overlord documentation to explain the architecture and mechanics of the Terminal Runner (`ovld runner`). This will help users and contributors understand how objectives are dispatched from the backend, claimed by local runners, and executed as terminal sessions via `ovld launch`.

We will also audit the CLI docs to remove deprecated/invalid commands such as `ovld open` (which doesn't exist on the CLI surface) to keep documentation in sync with the actual implementation.

## User Review Required

> [!NOTE]
> The documentation updates will be made directly to the web app's Next.js documentation pages under `apps/web/app/docs/workflow/agent-execution/page.tsx` and `apps/web/app/docs/surfaces/cli/page.tsx`. This ensures that they compile, build, and are immediately available on the live web documentation.

## Proposed Changes

We will modify two documentation pages:

### 1. `apps/web/app/docs/workflow/agent-execution/page.tsx`

We will expand the existing page to fully document the Terminal Runner architecture, including:
- **Durable Queue (`execution_requests`)**: Explain that the backend coordinates *what* should run (via a database row) but doesn't spawn terminals itself.
- **Terminal Runner (`ovld runner`)**: Explain that a runner process runs locally (on a workstation or remote host), claims pending requests, and performs the launch.
- **Architectural Diagram**: Use Mermaid flowcharts to show the triggers (manual Run button vs. agent delivery auto-advance), the queue, the claiming process, and the launch sequence.
- **Sequence Diagram**: A Mermaid sequence diagram showing the step-by-step API interactions (`deliver`, `claim-execution`, `ovld launch`, `complete-execution-launch`, `attach`).
- **CLI Commands**: Document the runner command surface (`ovld runner start`, `ovld runner once`, `ovld runner status`) and options (such as `--poll-interval-ms`, `--device-fingerprint`, `--project-id`).
- **Shared Queue**: Explain that manual Run buttons in the web UI and auto-advance triggers utilize the exact same underlying `execution_requests` queue.

### 2. `apps/web/app/docs/surfaces/cli/page.tsx`

- Audit the CLI page to remove `# Launch the desktop app \n ovld open` which is not a real CLI command.

---

## Verification Plan

### Automated Tests
We will verify that the Next.js web application builds successfully with our documentation updates by running:
```bash
cd apps/web && yarn build
```
This is crucial as a compilation or import error in a docs page will break the entire production build.

### Manual Verification
- Review the formatting of the updated markdown pages.
- Check that all internal page links resolve correctly.
