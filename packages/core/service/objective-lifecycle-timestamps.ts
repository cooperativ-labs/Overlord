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
 * `reopened_at` is the run boundary (coo:879, contract v133): stamped when an
 * objective that has already executed is set back to draft, and last-wins so
 * it always marks where the latest run begins. Only the draft transition
 * writes it; a post-delivery re-attach is part of the same run.
 *
 * Each fragment binds exactly one parameter — the ISO timestamp — so callers
 * append the value in the same order they append the fragment.
 */
export const OBJECTIVE_LAUNCHED_AT_ASSIGNMENT = 'launched_at = COALESCE(launched_at, ?)';
export const OBJECTIVE_STARTED_AT_ASSIGNMENT = 'started_at = COALESCE(started_at, ?)';
export const OBJECTIVE_COMPLETED_AT_ASSIGNMENT = 'completed_at = ?';
export const OBJECTIVE_REOPENED_AT_ASSIGNMENT = 'reopened_at = ?';

/**
 * The states from which a move back to `draft` counts as reopening a run, and
 * therefore stamps `reopened_at`. `launching → draft` (a wedged launch reset)
 * and `future → draft` (queue promotion) leave no evidence behind, so they are
 * not run boundaries.
 */
export const OBJECTIVE_REOPENABLE_STATES: readonly string[] = Object.freeze([
  'executing',
  'pending_delivery',
  'complete'
]);
