---
name: slideshow
description: How to create and add slideshows to the /presentations section. Covers folder layout, component contract, registry wiring, slide authoring rules, and local testing.
---

# slideshow

## Instructions

Use this skill whenever you are adding a new slideshow to the `/presentations` section of `apps/web`.

### Where Slideshows Live

Each slideshow is a folder inside the Next.js route-group `(components)`:

```
apps/web/app/presentations/(components)/<slug>/
├─ index.ts          ← default-exports the SlideshowDefinition
├─ Slide01.tsx
├─ Slide02.tsx
└─ ...
```

The `(components)` folder uses Next's route-group syntax — it is invisible to the router so your slide folders cannot become accidental routes.

### Type Contract

```ts
// apps/web/app/(app)/presentations/(components)/types.ts
export type SlideComponent = React.ComponentType<{ slideNumber: number; total: number }>;

export interface SlideshowDefinition {
  title: string;
  slides: SlideComponent[];   // ordered array
  theme?: 'dark' | 'light';  // optional, default 'dark'
}
```

Each slide receives its 1-based position and the total slide count as props — useful for progress indicators inside the slide itself.

### Adding a New Slideshow

1. **Create the folder** `apps/web/app/(app)/presentations/(components)/<slug>/`.

2. **Write your slides** — each is a regular React component that fills the viewport:

   ```tsx
   // Slide01.tsx
   export default function Slide01({ slideNumber, total }: { slideNumber: number; total: number }) {
     return (
       <div className="flex h-full w-full flex-col items-center justify-center bg-slate-950 text-white">
         <h1 className="text-5xl font-bold">Title Slide</h1>
       </div>
     );
   }
   ```

3. **Export the definition** from `index.ts`:

   ```ts
   import type { SlideshowDefinition } from '../types';
   import Slide01 from './Slide01';
   import Slide02 from './Slide02';

   const definition: SlideshowDefinition = {
     title: 'My Slideshow',
     slides: [Slide01, Slide02],
   };

   export default definition;
   ```

4. **Register the slug** in `apps/web/app/(app)/presentations/(components)/registry.ts`:

   ```ts
   export const SLIDESHOWS: Record<string, () => Promise<{ default: SlideshowDefinition }>> = {
     'existing-slug': () => import('./existing-slug'),
     'my-new-slug':   () => import('./my-new-slug'),   // ← add this line
   };
   ```

   The viewer page uses dynamic import so only the requested slideshow's bundle is loaded.

### Slide Authoring Rules

- **Full viewport** — slides render inside a fixed-inset frame that fills the browser window. Use `h-full w-full` on your root element; do not set explicit `height`/`width` pixel values.
- **No app chrome** — the `[slug]/layout.tsx` already removes the sidebar and nav. Do not add them back.
- **Compose existing components** — import `FeedCard`, `TerminalProvider`, charts, marketing sections, or any existing component freely. See `apps/web/example-tickets/demo-frames/DemoFeedShowcase.tsx` as the gold-standard pattern for composing real app components into a presentational frame.
- **Keep slide-specific logic inside the slide** — do not modify `SlideshowViewer.tsx`, `SlideFrame.tsx`, or `SlideNavControls.tsx` for per-slide behavior.
- **Theme** — dark by default. Use a slate-on-deep-navy palette consistent with the existing demo frames (e.g. `bg-slate-950`, `text-white`, `text-slate-300` for secondary text).
- **Props** — you may show a custom progress indicator using `slideNumber` / `total` props, but it is optional. The shared nav controls at the bottom already show `N / Total`.

### Viewer Behavior (for reference)

`SlideshowViewer` handles everything automatically — you do not need to wire these up:

| Action | Key(s) |
|--------|--------|
| Next slide | `ArrowRight`, `Space`, `PageDown` |
| Previous slide | `ArrowLeft`, `PageUp` |
| First slide | `Home` |
| Last slide | `End` |
| Toggle fullscreen | `f` |

Deep-link: `/presentations/<slug>?slide=N` (1-indexed, defaults to 1).

### Access Control

The section `layout.tsx` gates access to `jake@cooperativ.io` via `isAdminEmail()`. You do not need to add any auth check inside individual slides or the registry.

### Testing Locally

1. Start the dev server: `yarn dev` (from `apps/web` or repo root with turbo).
2. Navigate to `http://localhost:3000/presentations/<slug>`.
3. Step through slides with the arrow keys.
4. Verify `?slide=N` deep-links work (paste a URL with `?slide=3`).
5. Press `f` to confirm fullscreen toggle works.
6. Sign in as a non-admin user and confirm visiting `/presentations` redirects to `/`.

### What NOT To Do

- Do **not** write DB migrations or server actions for slide content — slides are code, not DB rows.
- Do **not** edit `SlideshowViewer.tsx` or `SlideNavControls.tsx` for a single slideshow's needs — keep viewer logic generic.
- Do **not** create routes outside `(components)/` for slide source files.
- Do **not** add new top-level dependencies just for one slide; prefer composing existing components.

## Examples

### Minimal two-slide deck

```ts
// apps/web/app/(app)/presentations/(components)/hello-world/index.ts
import type { SlideshowDefinition } from '../types';
import Slide01 from './Slide01';
import Slide02 from './Slide02';
const definition: SlideshowDefinition = { title: 'Hello World', slides: [Slide01, Slide02] };
export default definition;
```

```tsx
// Slide01.tsx
export default function Slide01() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-950">
      <h1 className="text-6xl font-bold text-white">Hello</h1>
    </div>
  );
}
```

```ts
// registry.ts — add one line
'hello-world': () => import('./hello-world'),
```

<!-- version: 1.1.0 -->
