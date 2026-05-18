# Presentations Section — Feature Plan

**Ticket:** 1:1126 — Create presentations section with restricted access
**Status:** Plan (no code yet)
**Owner gate:** Only `jake@cooperativ.io` (via existing `isAdminEmail` helper in `lib/auth/admin.ts`).

## Goal

A `/presentations` section of the web app where each slideshow is its own route. Slides are full-page React components composed from existing app components (same spirit as `apps/web/example-tickets/demo-frames/DemoFeedShowcase.tsx`). Navigation is keyboard-driven (← / →) and the current slide is reflected in a `?slide=N` search param. No creator UI — slideshows are authored by hand / by agents using a `slideshow` skill.

## Scope (v1)

In:
- `/presentations` index page listing known slideshows (admin-only).
- `/presentations/[slug]` viewer that renders the active slide for a slug.
- Authoring pattern: each slideshow lives in `apps/web/app/(app)/presentations/(components)/<slug>/` and exports an ordered array of slide components.
- Keyboard navigation, arrow buttons, slide counter, `?slide=N` deep-link, fullscreen-friendly layout.
- A populated `slideshow` skill (`.claude/skills/slideshow/SKILL.md`) with end-to-end instructions for adding a new slideshow.

Out (deferred):
- Slide editor / creator GUI.
- Persistence of slideshow definitions in the DB.
- Presenter notes, timer, audience view.
- Animations between slides beyond a simple fade/none.
- Sharing presentations with non-admin users.

## Route Layout

```
apps/web/app/(app)/presentations/
├─ layout.tsx                # auth gate (admin only) + minimal chrome
├─ page.tsx                  # index: list of slideshows
├─ [slug]/
│  └─ page.tsx               # viewer; reads ?slide=N
└─ (components)/
   ├─ SlideshowViewer.tsx    # client; keyboard + arrow nav; URL sync
   ├─ SlideFrame.tsx         # full-viewport wrapper for one slide
   ├─ SlideNavControls.tsx   # left/right arrow + counter
   ├─ registry.ts            # { slug -> { title, slides[] } }
   └─ <slug>/                # one folder per slideshow
      ├─ index.ts            # default export: { title, slides: SlideComponent[] }
      ├─ Slide01.tsx
      ├─ Slide02.tsx
      └─ ...
```

`(components)` uses Next's route-group syntax so the folder is ignored by the router — slideshow source folders cannot accidentally become routes.

## Access Control

Reuse the existing pattern from `apps/web/app/(app)/admin/page.tsx`:

```ts
// apps/web/app/(app)/presentations/layout.tsx
const supabase = await createClientForRequest();
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect('/login');
if (!isAdminEmail(user.email)) redirect('/');
```

This gives us a single gate at the section root that covers `/presentations` and every `/presentations/[slug]` route without duplicating checks.

## Slide Component Contract

```ts
// (components)/types.ts
export type SlideComponent = React.ComponentType<{ slideNumber: number; total: number }>;

export interface SlideshowDefinition {
  title: string;
  slides: SlideComponent[];           // ordered
  theme?: 'dark' | 'light';           // optional, default 'dark'
}
```

Each slide is a regular React component that fills the viewport. Authors compose existing UI freely — e.g. `FeedCard`, `TerminalProvider`, charts, marketing components — exactly like `DemoFeedShowcase` already does.

## Registry

`(components)/registry.ts` maps slugs to lazy-imported definitions so unused slideshow code is not pulled into other routes:

```ts
export const SLIDESHOWS: Record<string, () => Promise<{ default: SlideshowDefinition }>> = {
  'overlord-overview': () => import('./overlord-overview'),
};
```

The viewer page calls `SLIDESHOWS[slug]?.()`; missing slugs → `notFound()`.

## Viewer Behavior

`/presentations/[slug]?slide=N` (1-indexed; defaults to 1; clamps to `[1, slides.length]`).

`SlideshowViewer` (client component) responsibilities:
- Read `slide` from `useSearchParams()`; coerce to int; clamp.
- Render `slides[slide - 1]` inside `SlideFrame` (fixed inset, black background, centered content area, `theme` applied).
- Keyboard: `ArrowRight` / `Space` / `PageDown` → next; `ArrowLeft` / `PageUp` → prev; `Home` / `End` → first / last; `f` → toggle browser fullscreen via `document.documentElement.requestFullscreen()`.
- URL sync via `router.replace` (no history spam) so deep links work.
- Visible controls: left/right chevrons (bottom-corner), `N / Total` counter, fullscreen toggle. Auto-hide after a few seconds of inactivity.
- No app chrome inside the slide — the section layout should suppress the standard sidebar/nav for `/presentations/[slug]` (either by branching in the section `layout.tsx`, or by giving the viewer its own nested layout that sets fullscreen styling).

The section layout will likely need two states: index view (with normal chrome) and viewer view (fullscreen). Simplest: use a nested `[slug]/layout.tsx` that renders a fullscreen container, separate from the index's layout.

## Index Page

`/presentations` lists entries from `SLIDESHOWS` (title + slug + first-slide thumbnail optional later). Each entry links to `/presentations/<slug>`. Minimal styling — utility, not a marketing page.

## Files To Create / Touch

New:
- `apps/web/app/(app)/presentations/layout.tsx`
- `apps/web/app/(app)/presentations/page.tsx`
- `apps/web/app/(app)/presentations/[slug]/layout.tsx` (fullscreen wrapper, suppresses chrome)
- `apps/web/app/(app)/presentations/[slug]/page.tsx`
- `apps/web/app/(app)/presentations/(components)/SlideshowViewer.tsx`
- `apps/web/app/(app)/presentations/(components)/SlideFrame.tsx`
- `apps/web/app/(app)/presentations/(components)/SlideNavControls.tsx`
- `apps/web/app/(app)/presentations/(components)/registry.ts`
- `apps/web/app/(app)/presentations/(components)/types.ts`
- One example slideshow folder under `(components)/` so the pattern is exercised end-to-end.

Updated:
- `.claude/skills/slideshow/SKILL.md` — fill in description + instructions (currently a stub).
- `.claude/skills/SKILLS_INDEX.md` — regenerated by skills CLI to include `slideshow`.

No DB migrations, no server actions, no new dependencies expected.

## `slideshow` Skill — What Goes In It

The skill must teach an agent to add a new slideshow without re-reading this plan. Sections it should cover:
1. Where slideshows live (`apps/web/app/(app)/presentations/(components)/<slug>/`) and the folder convention.
2. The `SlideshowDefinition` / `SlideComponent` contract (copy from `types.ts`).
3. How to register a new slug in `registry.ts`.
4. Slide authoring rules: full-viewport, no app chrome, may import any existing component, prefer composing real components (`FeedCard`, demo frames, charts) over redrawing them. Reference `DemoFeedShowcase.tsx` as the gold-standard example of composing app components into a presentational frame.
5. Theme conventions (dark default, slate-on-deep-navy palette consistent with the demo frames).
6. How to test locally: visit `/presentations/<slug>`, step with arrow keys, confirm `?slide=N` deep-link works, confirm non-admin users hit `/`.
7. What NOT to do: no DB writes, no edits to `SlideshowViewer.tsx` for one-off slide behavior (keep slide-specific logic inside the slide component), no new top-level routes outside `(components)/`.

## Implementation Order

1. Section scaffolding: layout (auth gate), index page, types, registry, `SlideFrame`, `SlideNavControls`, `SlideshowViewer`, `[slug]/layout.tsx` + `page.tsx`.
2. One real example slideshow with 3–4 slides composing existing components (so the pattern is tested).
3. Fill in the `slideshow` skill.
4. Regenerate `SKILLS_INDEX.md` via the skills CLI.

## Open Questions

- Should the section appear in the sidebar (admin-only), or stay un-linked and accessed by URL? — Default: un-linked for v1; add a sidebar entry later if useful.
- Slide transitions (fade vs. none)? — Default: none in v1; easy to add later inside `SlideFrame`.
- Should `?slide=N` be 0- or 1-indexed? — 1-indexed for human-friendliness.
