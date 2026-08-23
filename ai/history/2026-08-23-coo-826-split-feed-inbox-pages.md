# coo:826.64g8 — Split live feed onto its own Feed page

Moved the cross-workspace live feed (and its mission drawer) off Inbox onto a dedicated `/feed` route. Inbox now holds unallocated capture plus Everything Queued. The sidebar lists Feed above Inbox.

Legacy `/inbox/missions/$missionId` URLs redirect to `/feed/missions/$missionId` so existing bookmarks still open the drawer.

Webapp typecheck passed. Browser click-through was not available in this session (no local webapp running).
