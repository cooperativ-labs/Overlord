# coo:954.jsn2 — Promote objective to first future (2026-09-07)

Promoting a future objective already spliced the current draft into the first
future slot on the server. The mission panel then ignored that order: its
local future-list merge kept remaining futures and appended the new id, so the
demoted draft jumped to last. Membership changes now take the server order, so
the demoted draft stays first and the rest of the future queue is preserved.
