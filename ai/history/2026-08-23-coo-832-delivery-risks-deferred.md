# coo:832 — Delivery known risks & deferred work on web/desktop

## Change

`webapp/web/components/DeliverySummaryCard.tsx` `DeliveryPresentation` already
rendered follow-up actions and tradeoffs from `delivery.report.presentation`, but
omitted `knownRisks`, `deferredWork`, and `assumptions` that mobile shows in
`DeliveryPresentationView.swift`.

## Result

Expanded delivery cards (mission panel + Inbox feed; desktop shares this SPA) now
show those sections when non-empty, in the same order and accent treatment as
mobile (red risks, violet deferred work, muted assumptions). No API or contract
change — fields were already on `DeliveryPresentationV1`.
