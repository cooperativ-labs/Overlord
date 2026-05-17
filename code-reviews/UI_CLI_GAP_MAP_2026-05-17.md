# UI Functions Without CLI Coverage

_Conducted: 2026-05-17 for ticket `1:1110`_

## Scope

- Compared the current web UI surface against the current CLI surface in `packages/overlord-cli/bin/_cli/*`.
- Excluded organization setup and onboarding flows, per ticket guidance.
- Focused on meaningful product actions, not every purely presentational toggle.

## Current CLI Surface Reviewed

- Top-level: `attach`, `create`, `prompt`, `auth`, `tickets`, `ticket`, `launch`, `restart`, `setup`, `doctor`, `update`
- Protocol: `auth-status`, `discover-project`, `attach`, `connect`, `load-context`, `revert`, `search-tickets`, `discuss-objective`, `create`, `prompt`, `record-work`, `update`, `record-change-rationales`, `ask`, `request-approval-gate`, `permission-request`, `hook-event`, `read-context`, `write-context`, attachment commands, device commands, project resource commands

## Gap Table

| Area | UI function | Primary UI entry point | Backing action(s) | CLI coverage | Notes |
| --- | --- | --- | --- | --- | --- |
| Tickets | Edit core ticket fields after creation: title/body/priority/project/execution target/assigned agent | `apps/web/components/features/TicketPanelContent.tsx` | `lib/actions/tickets.ts` (`updateTicketAction`, `updateTicketFieldAction`, `updateTicketPriorityAction`, `setTicketProjectAction`, `updateTicketExecutionTargetAction`, `updateTicketAssignedAgentAction`) | None | CLI can create/prompt tickets, but cannot edit existing ticket metadata outside protocol session updates. |
| Tickets | Manage future objectives: create draft objective, edit body, promote, reorder, delete, toggle auto-advance, clear approval wait | `apps/web/components/features/TicketObjectivesSection.tsx` | `lib/actions/tickets.ts` (`createEmptyDraftObjectiveAction`, `updateObjectiveBodyAction`, `promoteFutureObjectiveAction`, `reorderFutureObjectivesAction`, `deleteFutureObjectiveAction`, `setObjectiveAutoAdvanceAction`, `clearAwaitingApprovalAction`) | None | CLI has `discuss-objective`, but no surface for full future-objective management. |
| Tickets | Move an objective back to draft or mark executed from the UI | `apps/web/components/features/TicketObjectivesSection.tsx` | `lib/actions/tickets.ts` (`markObjectiveDraftAction`, `markObjectiveExecutedAction`) | None | Closely related to the future-objectives workflow but still missing as standalone CLI operations. |
| Tickets | Reorder tickets on the work board | board UI under projects/work board | `lib/actions/tickets.ts` (`reorderTicketsAction`) | None | No CLI support for board ordering. |
| Tickets | Mark tickets read/unread in inbox-style flows | `apps/web/components/features/InboxList.tsx` | `lib/actions/tickets.ts` (`markTicketReadAction`, `markTicketsReadAction`, `markTicketUnreadAction`) | None | CLI can search/list tickets, but not manage read state. |
| Tickets | Add and remove user tags on tickets | `apps/web/components/features/TicketTagEditor.tsx` | `lib/actions/tags.ts` (`applyUserTagToTicketAction`, `removeUserTagFromTicketAction`) | None | No CLI support for personal tagging. |
| Tickets | Edit due date and recurring schedule | `apps/web/components/features/TicketPanelContent.tsx` via `DueDateEditor` and `ScheduleEditor` | `lib/actions/ticket-schedules.ts`, `lib/actions/tickets.ts` (`upsertTicketScheduleAction`, `clearTicketScheduleAction`, `updateTicketDueDateAction`) | None | Scheduling is UI-only today. |
| Tickets | Delete a ticket or enable ticket auto-delete | `apps/web/components/features/DeleteTicketButton.tsx`, `TicketAutoDelete.tsx` | `lib/actions/tickets.ts` (`deleteTicketAction`) | None | No CLI delete/archive command for tickets. |
| Tickets | Delete an existing objective attachment | `apps/web/components/features/ObjectiveAttachmentUpload.tsx` | `lib/actions/attachments.ts` (`deleteObjectiveAttachmentAction`) | Partial | CLI can list, upload, and fetch download URLs for attachments, but not delete them. |
| Feed | Browse completed-work feed and filter by project | `apps/web/app/(app)/feed/page.tsx`, `apps/web/components/features/feed/FeedList.tsx` | `lib/actions/feed.ts` (`getFeedPostsAction`, `getExecutingFeedTicketsAction`) | None | No CLI for reading the feed or filtering feed posts. |
| Projects | Create, rename, recolor, move, and delete projects | `apps/web/components/features/projects/*` | `lib/actions/projects.ts` (`createProject`, `updateProjectNameAction`, `updateProjectColorAction`, `moveProjectToOrganizationAction`, `deleteProjectAction`) | None | CLI can discover a project and attach work to it, but not administer projects. |
| Projects | Configure project working directory and SSH settings | project settings UI | `lib/actions/projects.ts` (`updateProjectWorkingDirectoryAction`, `updateProjectSshConfigAction`) | None | Related protocol support exists for resource directories, but not for the core per-project working-directory/SSH settings used by the UI. |
| Projects | Remove a project resource directory | `apps/web/components/features/projects/ResourceDirectoryList.tsx` | `lib/actions/resource-directories.ts` (`removeProjectResourceDirectoryAction`) | Partial | CLI has `list-project-resources`, `add-project-resource`, and `update-project-resource`, but no remove command. |
| Projects | Save repo operations profile / current-changes profile settings | project current-changes/settings UI | `lib/actions/repo-profile.ts` (`saveOperationsProfileAction`) | None | No CLI equivalent for these repo profile preferences. |
| Integrations | Configure Everhour, start/stop timer, manage time records | `apps/web/components/features/everhour/*` | `lib/actions/everhour.ts` | None | Entire Everhour workflow is UI-only. |
| Integrations | Configure Slack workspace + per-project default status | `apps/web/components/features/slack/*` | `lib/actions/slack.ts` | None | No CLI surface for Slack integration settings. |
| Account | Update profile name/image/password | `apps/web/components/modals/settings/UserProfilePage.tsx` | `lib/actions/account.ts` (`updateProfileNameAction`, `uploadProfileImageAction`, `removeProfileImageAction`, `updatePasswordAction`, `setPasswordAction`) | None | CLI auth covers login/logout/status only. |
| Account | Link/disconnect GitHub and Bitbucket identities | `apps/web/components/modals/settings/LinkedAccountsPage.tsx` | `lib/actions/account.ts` (`linkGithubIdentityAction`, `linkBitbucketIdentityAction`, `disconnectIdentityAction`) | None | No CLI for identity linking. |
| Account | List and revoke personal agent tokens | settings UI | `lib/actions/user-agent-tokens.ts` (`listUserAgentTokensAction`, `createUserAgentTokenAction`, `revokeUserAgentTokenAction`) | None | Useful CLI candidate for headless workflows. |
| Devices | View all devices and relabel a chosen device | device/account settings UI | `lib/actions/devices.ts` (`getUserDevicesAction`, `updateDeviceLabelAction`) | Partial | Protocol CLI can `get-device` and `update-device` for the current fingerprint, but not list all devices or target arbitrary devices. |
| Preferences | Save agent config, launch flags, model preference, custom instructions, default project, list-view defaults | settings modal (`AgentsAndMcpPage`, `ApplicationPage`, `CustomizationPage`, etc.) | `lib/actions/agent-config.ts`, `profile-settings.ts`, `global-list-view-preferences.ts`, `user-launch-preference.ts`, `project-user-preferences.ts`, `view-preference.ts` | None | This is a broad UI-only preference surface today. |

## Takeaways

- The CLI is strong for ticket execution lifecycle work, attachments, device self-registration, and project resource registration.
- The biggest missing CLI category is post-creation ticket editing and future-objective management.
- The second major gap is admin/configuration work outside onboarding: projects, integrations, account settings, and user preferences.
- The two clearest partial-coverage follow-ups are project resource deletion and attachment deletion.
