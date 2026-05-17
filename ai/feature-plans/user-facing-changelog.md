# User-Facing Changelog — Engineering Plan

## Goal

Create a curated, user-facing changelog ("What's New") that highlights notable product changes since the last release entry. The same content surfaces in three places:

1. A public marketing page (e.g. `/changelog`).
2. A modal shown inside the Electron desktop app after an in-app update is installed.
3. A periodic email blast to users.

Authoring is admin-driven and AI-assisted: an admin clicks a button, a Gemini edge function drafts the entry by reading feed posts since the previous changelog entry, the admin edits the markdown, previews the styled output, then publishes.

This is intentionally distinct from the existing engineering-facing `CHANGELOG.md` and from the per-ticket `feed_posts` stream — the new table is user-facing release notes only.

## Authoring workflow

1. Admin opens **Admin → Changelog** (new panel on `app/(app)/admin/page.tsx`).
2. Admin clicks **Generate Changelog Entry**.
   - Server action calls a new edge function `generate-changelog-draft`.
   - The function loads all `feed_posts` with `created_at > (last published changelog_entries.source_window_end)` (falling back to a sensible default such as 30 days if no prior entry exists), formats them into a Gemini prompt, and returns markdown plus a suggested `title` and `summary`.
3. A new draft row is created in `changelog_entries` with `status = 'draft'`, the returned markdown stored on `body_markdown`, and the source window recorded.
4. The admin lands on a markdown editor (`@uiw/react-md-editor` or the project's existing markdown component plus a `textarea`) seeded with the AI draft. They edit freely.
5. **Preview** toggle renders the markdown using the existing `MarkdownContent` component so the admin sees the final styled output before publishing.
6. Admin clicks **Publish**.
   - Server action sets `status = 'published'`, stamps `published_at`, and renders the markdown server-side to sanitized HTML stored on `body_html` (single source of truth for surfaces that can't run a markdown renderer, like the email).
   - Optionally triggers the email send job.

## Database

New migration `supabase/migrations/<ts>_changelog_entries.sql`:

```sql
create table public.changelog_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references public.organizations(id) on delete cascade,
  slug text not null,                   -- url slug, e.g. '2026-05-week-3'
  title text not null,
  summary text,                         -- 1-2 sentence teaser for modal/email preview
  body_markdown text not null,          -- admin-edited source of truth
  body_html text,                       -- sanitized HTML, written on publish
  status text not null default 'draft', -- 'draft' | 'published' | 'archived'
  version text,                         -- optional app version this entry corresponds to
  source_window_start timestamptz,      -- earliest feed_post considered by the drafter
  source_window_end timestamptz,        -- latest feed_post considered
  source_feed_post_ids uuid[] not null default '{}',
  drafted_by uuid references auth.users(id),
  published_by uuid references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create index idx_changelog_entries_status_published on public.changelog_entries (status, published_at desc);
```

RLS:
- `select` on `status = 'published'` allowed for **anon + authenticated** so the public marketing page can render without auth. All other rows admin-only.
- All write policies: admin-only (existing `isAdminEmail` gate enforced in the server action; RLS policy checks the JWT `email` claim or uses a service-role-issued path).

Run `yarn generate` after applying the migration so `types/database.types.ts` picks up the new table.

## Edge function: `generate-changelog-draft`

`supabase/functions/generate-changelog-draft/index.ts`, modeled on `generate-feed-post`:

- Auth: requires service-role or an authenticated admin user (verify via JWT claims; reject otherwise).
- Input: `{ organizationId, sinceTimestamp?, until? }`. If `sinceTimestamp` is omitted, look up the latest `published` `changelog_entries.source_window_end` for the org and use that; otherwise default to `now() - interval '30 days'`.
- Loads `feed_posts` in the window, ordered ascending, and formats `title`, `body`, `tags`, `impact_level`, `human_actions`, and `tradeoffs` into a compact prompt.
- Calls Gemini (`gemini-3-flash-preview`, same model as `generate-feed-post`) with structured JSON output:
  ```ts
  {
    title: string,
    summary: string,
    body_markdown: string,
    suggested_slug: string,
    used_feed_post_ids: string[]
  }
  ```
- System prompt should instruct the model to:
  - Group entries by theme (Added / Improved / Fixed) rather than per-ticket.
  - Write for end users, not engineers — drop internal ticket IDs, agent names, and file paths.
  - Prefer scannable bullet lists with bold leading phrases.
- Returns the draft to the caller; **does not** write to the DB. The Next.js server action persists the result so DB schema concerns stay in one place.

See the existing `gemini-api` and `edge-functions` skills for the SDK wiring patterns to follow.

## Server actions (`lib/actions/changelog.ts`)

- `generateChangelogDraftAction()` — admin-only; invokes edge function, creates a `draft` row, returns `{ id, body_markdown, source_window_start, source_window_end }`.
- `updateChangelogDraftAction(id, fields)` — patches `title`, `summary`, `body_markdown`, `slug`, `version`.
- `publishChangelogEntryAction(id)` — admin-only; renders markdown → sanitized HTML using `unified` + `rehype-sanitize` (or the same renderer used by `MarkdownContent` server-side), writes `body_html`, sets `status='published'`, `published_at = now()`, `published_by = uid`. Optionally enqueues the email send.
- `listPublishedChangelogEntriesAction(limit?)` — public; used by the marketing page and the Electron modal.
- `getLatestPublishedChangelogEntryAction()` — used by the Electron post-update modal.

Validation with Zod v4 (see `zod-v4-patterns` skill). All admin-only actions guarded by the existing `isAdminEmail` helper.

## Admin UI

New file: `apps/web/components/features/admin/ChangelogPanel.tsx`, mounted into the admin page alongside `AppFeaturesPanel`.

Layout:
- **Left column**: list of existing entries (draft + published), with status badge and date.
- **Right column** (when an entry is selected):
  - Header inputs: `title`, `slug`, `version`, `summary`.
  - Tabbed body editor: **Edit** (markdown `textarea`, monospace, auto-save on blur) and **Preview** (renders through `MarkdownContent`).
  - Footer actions: `Save Draft`, `Publish` (`LoadingButton`, per the `loading-button` skill), `Archive`.
- **Top action**: `Generate Changelog Entry` `LoadingButton` — calls `generateChangelogDraftAction()` and auto-selects the new row.

Markdown editor: use a plain `Textarea` with monospace styling rather than a heavy WYSIWYG — keeps the bundle small and matches the "edit raw markdown, preview separately" requirement. Consider `@uiw/react-md-editor` only if syntax highlighting becomes important.

## Public marketing page

`apps/web/app/changelog/page.tsx` (outside the `(app)` group so it's accessible unauthenticated):

- Server component; calls `listPublishedChangelogEntriesAction()`.
- Renders each entry's `body_html` (already sanitized at publish time) inside a styled container that mirrors the marketing page typography.
- Add to `sitemap.ts` and `robots.txt` allowances.

`apps/web/app/changelog/[slug]/page.tsx` for permalinks.

## Electron "What's new" modal

After `app-updater` reports `phase: 'downloaded'` and the user restarts into the new version:

1. On main-window load, the renderer reads the **installed app version** (`app.getVersion()` exposed via IPC) and compares with the locally-stored `lastSeenChangelogVersion` (in `electron-store` / existing settings store).
2. If they differ, fetch `getLatestPublishedChangelogEntryAction()` and check whether its `version` matches the current app version (or is newer than `lastSeenChangelogVersion`).
3. If yes, render a modal in the renderer (`apps/web/components/features/changelog/ChangelogUpdateModal.tsx`) that displays `title`, `summary`, and `body_html`. CTA: **Got it** → writes `lastSeenChangelogVersion` and closes.

The modal component is shared with the web app so it can also be shown on first visit after a release if desired (gated by a localStorage key).

## In-app launch toast (bottom-left notification)

Users see a dismissible toast notification in the bottom-left corner when they launch the app or navigate to a new page, alerting them to new changelog posts published since their last visit. This surfaces the changelog within the product without requiring navigation, improving discoverability.

### Database tracking

Add a single column to the existing `profiles` table:

```sql
alter table public.profiles add column last_changelog_read_at timestamptz default now();
```

### Detection logic

On app load (or layout mount in `app/layout.tsx` / `app/(app)/layout.tsx`):

1. Server action `getUnreadChangelogEntriesAction()`:
   - Fetches published changelog entries where `published_at > user.profiles.last_changelog_read_at`.
   - Limits to the **most recent 1–2** entries to avoid overwhelming the user with old backlog.
   - Returns `{ id, title, summary, published_at }`.

2. If unread entries exist, render a `ChangelogToast` component (see below) that displays on the client.

### Toast component (`ChangelogToast.tsx`)

Location: `apps/web/components/features/changelog/ChangelogToast.tsx`

Layout:
- **Position**: `fixed bottom-4 left-4` (bottom-left, on top of other UI).
- **Content**: "📰 **New**: [title]" + brief summary + **Read More** CTA + dismiss button (×).
- **Styling**: subtle background (glass effect or muted surface), smooth fade-in animation.
- **Dismissal**:
  - Clicking **Read More** → navigate to `/changelog` (or `/changelog/[slug]`) and record the entry as read.
  - Clicking **×** → dismiss the toast without marking as read (user sees it again on next session).
  - Auto-dismiss after 6 seconds, or on route change if user navigates away.

State management:
- Render toast server-side if unread entries exist; show/hide client-side with a state hook.
- Use `Sonner` (existing toast library, if available) or a custom toast manager to avoid stacking conflicts with other toasts.
- On CTA click, call `markChangelogAsReadAction(entryId)` which inserts a `user_changelog_reads` row (marked `dismissed_at = null` for "intentionally read" vs dismissed).

### Server actions (`lib/actions/changelog.ts`)

Add to existing changelog actions:

- `getUnreadChangelogEntriesAction()` — returns published entries where `published_at > user.profiles.last_changelog_read_at`, limited to most recent 1–2.
- `markChangelogAsReadAction()` — updates `profiles.last_changelog_read_at = now()` for the current user. Called when user clicks "Read More" on the toast or navigates to `/changelog`.

### Layout integration

In `apps/web/app/(app)/layout.tsx` or a root layout component:

```tsx
import { getUnreadChangelogEntriesAction } from '@/lib/actions/changelog';
import ChangelogToast from '@/components/features/changelog/ChangelogToast';

export default async function AppLayout({ children }) {
  const unreadEntries = await getUnreadChangelogEntriesAction();

  return (
    <>
      {children}
      {unreadEntries.length > 0 && (
        <ChangelogToast entries={unreadEntries} />
      )}
    </>
  );
}
```

The `ChangelogToast` component handles client-side state and animations; the parent layout ensures it's always available.

## Email delivery

Out of scope for the first cut but designed for: on publish, `publishChangelogEntryAction` enqueues a `changelog_email_jobs` row (or invokes an edge function `send-changelog-email`) that reads all opted-in user emails and dispatches via the existing transactional email provider. The email body is the same `body_html` wrapped in a minimal template. Track sends in `changelog_email_sends (entry_id, user_id, sent_at)` to avoid double-sends and to support resend.

A `Send Email` button on the published-entry view triggers this job manually for the first iteration.

## Surfaces summary

| Surface | Reads | Trigger |
| --- | --- | --- |
| Admin authoring UI | `changelog_entries` (all) | Admin nav |
| Public `/changelog` | `changelog_entries` where `status='published'` | Anonymous visit |
| Electron post-update modal | latest published entry | First boot after `app-updater` install |
| Email blast | `body_html` of an entry | Admin clicks `Send Email`, or post-publish hook |

## Implementation order

1. Migration + types regen (`yarn generate`).
2. Edge function `generate-changelog-draft` + Gemini prompt tuning.
3. Server actions in `lib/actions/changelog.ts`.
4. Admin `ChangelogPanel` with generate / edit / preview / publish loop.
5. Public `/changelog` route + permalinks.
6. Electron post-update modal wiring (renderer + main IPC for version + last-seen).
7. Email job (table, edge function, admin send button).

## Open questions

- Should `changelog_entries` be org-scoped (current plan) or global? Org-scoped lets each tenant author their own; if "user-facing" means "Overlord users globally," consider dropping `organization_id` or pinning to a single internal org. **Recommend org-scoped with a designated marketing org for the public page** to keep the schema uniform.
- Sanitizer choice for `body_html` (`rehype-sanitize` vs DOMPurify on server) — pick whichever the existing `MarkdownContent` already uses to avoid divergence.
- Version coupling: the Electron modal needs a reliable mapping from `changelog_entries.version` to the installed Electron app version. Decide whether `version` is required at publish time (recommended).
