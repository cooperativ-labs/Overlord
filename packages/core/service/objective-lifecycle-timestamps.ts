/**
 * SQL assignment fragments that stamp an objective's lifecycle moments.
 *
 * A mission's objective list is ordered by *when* each objective moved through
 * the lifecycle — completed first in completion order, then executing in start
 * order, then launching in launch order (see `deriveObjectiveLifecycleView` in
 * `@overlord/automations`). That ordering only works if every transition site
 * records its moment, so these fragments exist to keep the handful of writers
 * spelling the same thing.
 *
 * `launched_at` and `started_at` are **first-wins**: an objective that is
 * re-launched, or re-attached for follow-up work after delivery, keeps the
 * place it already earned in the list. `completed_at` is last-wins, matching
 * the pre-existing completion write.
 *
 * Each fragment binds exactly one parameter — the ISO timestamp — so callers
 * append the value in the same order they append the fragment.
 */
export const OBJECTIVE_LAUNCHED_AT_ASSIGNMENT = 'launched_at = COALESCE(launched_at, ?)';
export const OBJECTIVE_STARTED_AT_ASSIGNMENT = 'started_at = COALESCE(started_at, ?)';
export const OBJECTIVE_COMPLETED_AT_ASSIGNMENT = 'completed_at = ?';
