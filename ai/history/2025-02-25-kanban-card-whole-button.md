# KanbanCard Whole Card Button (c7b26776)

**Date:** 2025-02-25  
**Ticket:** c7b26776 — Whole card is button

## Summary

Made the entire KanbanCard clickable to open the ticket in the SidePanel, while keeping the Everhour timer button independently clickable and adding a hover shadow.

## Changes

### `app/tickets/(components)/KanbanCard.tsx`

1. **Whole card as button**
   - Added `onClick` handler that navigates to the ticket path via `router.push(ticketPath)`
   - Uses `useRouter` from Next.js navigation
   - Added `aria-label` for accessibility

2. **Everhour timer independence**
   - `KanbanTimerButton` already calls `e.stopPropagation()` in its click handler
   - Clicks on the timer button do not bubble to the card, so they do not trigger navigation

3. **Hover shadow**
   - Added `hover:shadow-md` and `transition-all` to the Card `className`

4. **Removed nested Links**
   - Replaced title `Link` and panel icon `Link` with plain elements (span/h4)
   - Avoids invalid nested links and redundant navigation

5. **Cleanup**
   - Removed unused `Link` import
   - Removed `ticketPath` prop from `KanbanCardBody` (no longer needed)

## Technical Notes

- Used `onClick` + `router.push` instead of wrapping in `Link` because `KanbanTimerButton` renders a `<button>`, and buttons inside anchors are invalid HTML
- Kept `cursor-grab` for drag-and-drop affordance
- Did not add `role="button"` or `tabIndex={0}` because `useSortable` attributes already set `role` and would conflict
