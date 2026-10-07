# Chat diagnostics viewer responsiveness — 2026-10-07

Mission `coo:1127.q59w`. This objective implements proposal P3 from [the proposals](chat-optimization-proposals-2026-10-07.md), following the frontend findings in [the audit](chat-diagnostics-audit-2026-10-07.md). The aggregate measurements are in [chat-diagnostics-viewer-2026-10-07.metrics.json](chat-diagnostics-viewer-2026-10-07.metrics.json).

**These are browser-only results. They save zero model tokens and do not change provider cost or chat latency.** The viewer only reads owner-private diagnostics that are already captured, and nothing it does reaches the model.

## What changed (`webapp/web/components/chat/ChatDiagnostics.tsx`)

| Audit finding (v159 viewer)                                                                                | Change                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[...previous, ...page.entries]` copies the whole history on every 100-row page (quadratic over a backlog) | Append-only resident log mutated in place, plus a row count in state. Rows are de-duplicated by ascending `seq`, which guards cursor correctness.                                                                                                         |
| One `<details>` per retained row (20k DOM nodes at 10k rows)                                               | Windowed rendering. Collapsed rows have a fixed 26 px height. Expanded rows are measured with a `ResizeObserver`, so offset and scroll math cost O(expanded rows), not O(history). There are 12 rows of overscan, and the scroll height covers every row. |
| Expansion state lives in the row, so it is lost if the row unmounts                                        | Expansion state is lifted into a `seq → measured height` map. It survives rows leaving and re-entering the window and is reset on thread change.                                                                                                          |
| Pretty-printed JSON when expanded                                                                          | Kept: `JSON.stringify(payload, null, 2)` runs only while a row is expanded and renders as escaped text in `<pre>`. Collapsed rows keep the full metadata line, both in a `title` and in the expanded summary.                                             |
| Polls every second while the tab is hidden                                                                 | Polling stops when `document.visibilityState === 'hidden'`, including after an in-flight request finishes. It resumes immediately from the same `after` cursor when the tab is visible again, and the header shows "Paused while hidden".                 |
| 401/403/404 clears the view                                                                                | Kept, and polling now stops so a hidden→visible transition cannot restart it.                                                                                                                                                                             |

What did not change: capture, the diagnostics route, the 100-row ordered paging, retention and cascades. No rows are sampled or suppressed, and no backend history is deleted. Every retained row stays reachable by scrolling. The parent still remounts the viewer on account-scope or thread change (`key={scope:threadId}`), and the component also resets its log, cursor and expansion state when `threadId` changes. No contract version bump is needed, and `CONTRACT.md` v159 gained a short Web-only note.

## Method

`scripts/evaluate-chat-diagnostics-viewer.mjs` bundles the working-tree component and the baseline component from `git show HEAD:` (`0ac2a10e`). Both use the production React build. The script runs each in a fresh `about:blank` page in fresh headless Chrome 154 at 900×800. It runs 5 repetitions per variant per size and alternates the variant order between repetitions.

- **History:** synthetic ordered pages shaped like the audited thread. Every 15 rows contain one growing `provider.request` (4–33 turns × 5 KB), one response, one tool response and twelve streamed chunks. That gives 6.4, 33.7 and 67.4 MiB of page JSON at 1k, 5k and 10k rows.
- **Paging:** the mocked `api.getChatDiagnostics` parses pre-serialized page strings, so JSON parse cost is real and timed separately.
- **Drain:** time from mount until the header shows N entries plus two animation frames. Script, layout and style time are deltas of CDP `Performance.getMetrics` over the whole scenario.
- **Heap:** viewer-attributable heap is `Runtime.getHeapUsage` after forced GC, minus the same measurement before mount. The synthetic page strings are present in both measurements.
- **Interactions:** five live appends, 21 scroll steps across the full height, expanding the last visible `provider.request` row, and polls counted over 3 s with `visibilityState` forced to hidden.

## Results (median [min–max] of 5 runs)

| Rows   | Variant  | Drain to frame ms         | Layout ms           | Style ms            | Viewer heap MiB | DOM nodes | Expand → frame ms | Hidden polls / 3 s |
| ------ | -------- | ------------------------- | ------------------- | ------------------- | --------------: | --------: | ----------------- | -----------------: |
| 1,000  | baseline | 95.5 [85.3–99.2]          | 26.7 [23.0–30.7]    | 17.9 [12.7–28.5]    |             9.4 |     2,022 | 49.6 [48.7–55.9]  |                  3 |
| 1,000  | current  | 69.8 [68.6–74.7]          | 30.2 [13.9–38.8]    | 18.2 [8.1–26.3]     |             7.4 |        59 | 48.9 [46.4–54.6]  |                  0 |
| 5,000  | baseline | 520.3 [469.8–552.9]       | 157.4 [133.2–161.6] | 136.2 [117.4–145.1] |            45.1 |    10,022 | 47.1 [44.8–50.7]  |                  3 |
| 5,000  | current  | 298.7 [293.5–326.2]       | 32.9 [31.7–37.0]    | 20.4 [19.2–22.7]    |            34.8 |        61 | 49.8 [47.8–51.7]  |                  0 |
| 10,000 | baseline | 1,561.6 [1,368.2–2,201.0] | 476.0 [409.2–663.5] | 370.0 [306.2–508.3] |            89.8 |    20,022 | 80.8 [75.8–99.0]  |   3 (2 in one run) |
| 10,000 | current  | 616.0 [610.2–627.5]       | 36.5 [32.2–38.1]    | 19.9 [18.1–23.1]    |            69.1 |        59 | 46.1 [45.1–53.6]  |                  0 |

- **Drain (backlog paging):** 27% faster at 1k rows, 43% at 5k and 61% at 10k. Variation also collapsed: at 10k the baseline ranged 1.37–2.20 s and the new viewer 0.61–0.63 s. Layout and style now stay flat at about 35 ms and 20 ms whatever the history size, where the baseline's grew linearly. Script time is about 15 ms higher at 1k rows because of the windowing bookkeeping. It is 45% lower at 5k and 66% lower at 10k.
- **Memory:** viewer heap is 21–23% lower. The remaining heap is the retained payload objects themselves, about 6.9 MiB per 1k rows of this mix, and that cost is required for complete in-browser inspection (see below).
- **DOM:** 59–61 nodes regardless of history size, compared with 2 per row in the baseline.
- **Expansion:** expanding a 36–56k-character payload costs about 46–50 ms to the next frame at every size. The baseline reached 81 ms at 10k because of whole-document layout.
- **Hidden view:** 0 requests while hidden, compared with one per second. Resuming triggers one immediate request from the retained cursor (verified in a unit test).
- **No discrimination on these two:**
  - _Scroll:_ both variants are about 33 ms per step to two frames, which is frame-bound at 60 Hz. The p95 was 37–46 ms for the baseline and 37–39 ms for the new viewer.
  - _Live append:_ both take about 900 ms from data availability to frame. That figure is dominated by the unchanged 1-second idle poll interval, so this benchmark does not isolate append render cost.
- **Parse:** `JSON.parse` time is the same work in both variants. The recorded parse time was 3–11 ms higher for the new viewer at 5k/10k rows. This is most likely GC timing landing inside the timed parse window, not a real change, and parse is under 5% of drain in either variant.
- **Long tasks:** headless Chrome reported none, apart from one 55 ms baseline sample. Long-task totals are therefore not used as evidence.

## Verification

`ChatDiagnostics.test.tsx` has 6 tests, which pass. They cover:

- the existing escaped-payload and unmount test
- 2,000-row backlog paging with cursors 0…1900 in order and fewer than 60 rendered rows; scrolling to rows 1,000 and 2,000 shows contiguous ordered windows
- expansion surviving a scroll out of and back into the window
- hidden pause: no polls for 1.3 s, then live rows 151–152 appended in order after resume from cursor 150, with the "Paused"/"Live" label
- a thread change restarting at cursor 0 and dropping the previous thread's expansion state
- a 404 clearing the view and stopping polling

All 37 chat web tests pass. ESLint and Prettier are clean on the changed files. Webapp `tsc` reports one error, in `components/activity-feed/MissionRunCard.tsx`, which is unrelated and belongs to concurrent uncommitted work.

## Decisions and limits

- **No resident-payload eviction.** Evicting off-screen payloads and re-fetching them through `after=seq-1` would cut heap further. It would also add network round-trips, failure states and cursor bookkeeping to every revisit of history. The measured heap is linear in captured content and below the page JSON size. Eviction is left for a future objective if real histories show memory pressure.
- **Measured and unmeasured:** these are controlled synthetic-history measurements in headless Chrome. They were not taken on real owner diagnostics, on a physical display, or in Desktop's Electron shell, which uses the same SPA.
- **Rerun:** `node scripts/evaluate-chat-diagnostics-viewer.mjs --sizes 1000,5000,10000 --runs 5`. Per-sample data is written only to a private `0700` temp directory.
