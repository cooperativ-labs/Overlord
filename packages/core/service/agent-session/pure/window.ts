/**
 * Pure decision-window policy.
 *
 * The durable request service applies this policy before persisting a request; keeping the
 * sizing calculation pure makes the active/away and harness-timeout boundary independently
 * testable by every transport shape.
 */
export const ACTIVE_DECISION_WINDOW_SECONDS = 30;
export const AWAY_DECISION_WINDOW_SECONDS = 30 * 60;

export function sizeDecisionWindow({
  presence,
  harnessTimeoutSeconds,
  projectWindowSeconds
}: {
  presence: 'active' | 'away' | 'unknown';
  harnessTimeoutSeconds: number | null;
  projectWindowSeconds?: number | null;
}): { seconds: number; basis: string } {
  if (projectWindowSeconds === 0) return { seconds: 0, basis: 'project_policy_zero' };
  const requested =
    projectWindowSeconds && projectWindowSeconds > 0
      ? projectWindowSeconds
      : presence === 'active'
        ? ACTIVE_DECISION_WINDOW_SECONDS
        : AWAY_DECISION_WINDOW_SECONDS;
  const basis =
    projectWindowSeconds && projectWindowSeconds > 0
      ? 'project_policy'
      : presence === 'active'
        ? 'presence_active'
        : `presence_${presence}`;
  if (harnessTimeoutSeconds === null) return { seconds: requested, basis };
  const capped = Math.min(requested, Math.max(1, Math.floor(harnessTimeoutSeconds * 0.8)));
  return { seconds: capped, basis: capped < requested ? `${basis}_clamped_to_harness` : basis };
}
