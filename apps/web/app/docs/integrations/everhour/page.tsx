import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Everhour'
};

export default function EverhourPage() {
  return (
    <DocsMarkdownPage
      title="Everhour"
      lead="Connect your Everhour account to track time directly from Overlord tickets."
    >
      {`
## 1. Generate your Everhour API token

1. Open Everhour.
2. Go to **Settings → My Profile**.
3. Copy the value under **API Token**.

This is a personal key — each teammate must add their own token.

## 2. Run the database migration

Apply the migration that adds:

- \`tickets.everhour_task_id\`
- \`user_integrations\` table (stores per-user Everhour API keys with RLS)
- \`projects.everhour_project_id\` (links local projects to Everhour projects)

## 3. Save your token in the app

1. Open **/account** in Overlord.
2. In the Everhour section, paste your API key.
3. Click **Save Key**.

## 4. Sync your Overlord projects to Everhour

1. Open any ticket in the target organization.
2. In the **Project** section, click **Sync Projects to Everhour**.
3. Select a synced project (shown with \`(Everhour)\` in the dropdown).

## 5. Share one Everhour project across multiple Overlord projects

Several Overlord projects can map to the same Everhour project so their time
rolls up together.

1. Open a project's **Settings → Integrations**.
2. Under **Share an existing Everhour project**, pick an Everhour project that is
   already linked to another Overlord project in the same organization.
3. Click **Link**. This project adopts the selected Everhour project ID (and its
   display name), so timers and time entries from both projects land in the same
   Everhour project.

## 6. Verify it works

1. Open any ticket.
2. In **Time Tracking**, click **Start Timer**.
3. Stop the timer.
4. Confirm entries appear and test add/edit/delete.

## Notes

- Everhour timers are per-user. You can only run one at a time.
- Starting a timer on a different ticket stops the previous one in Everhour.
- A ticket must have a project assigned, and that project must be synced to Everhour.
- Ticket time entries are retrieved from \`GET /tasks/{task_id}/time\` with required \`from\` and \`to\` dates.
- That endpoint also supports pagination via \`limit\` and \`page\`.
      `}
    </DocsMarkdownPage>
  );
}
