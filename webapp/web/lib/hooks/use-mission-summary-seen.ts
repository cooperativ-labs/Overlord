import type { MissionSummaryResponse } from '@overlord/contract';
import { type RefObject, useEffect, useRef, useState } from 'react';

import { useMarkMissionSummarySeen } from '../queries.ts';

/** How long a displayed evidence snapshot must stay visible before it is acknowledged (plan §5.2). */
export const MISSION_SUMMARY_SEEN_DELAY_MS = 2_000;

/**
 * The new-item dot baseline for one visit (plan §5.2): the caller's `seenAt`
 * captured once, from the first eligible envelope after mount, and never
 * changed by later seen writes or refetches. Mount the owning component with
 * `key={missionId}` so the next visit captures a fresh baseline.
 *
 * Returns `undefined` until an eligible envelope has loaded.
 */
export function useMissionSummaryVisitBaseline(
  response: MissionSummaryResponse | undefined
): string | null | undefined {
  const baselineRef = useRef<{ value: string | null } | null>(null);
  if (baselineRef.current === null && response?.eligible) {
    baselineRef.current = { value: response.seenAt };
  }
  return baselineRef.current?.value;
}

/**
 * Whether `targetRef` is in the viewport (at least a quarter of it) and the page is in the
 * foreground. A background tab, a minimised window or a scrolled-away element is not visible.
 * Pass `enabled` false while the element is not mounted (an unselected tab panel): the observer is
 * re-attached when it turns true, so an element that mounts later is still observed, and a
 * previously observed element never keeps counting as visible after it leaves.
 */
export function useForegroundVisible(
  targetRef: RefObject<HTMLElement | null>,
  enabled: boolean
): boolean {
  const [inViewport, setInViewport] = useState(() => typeof IntersectionObserver === 'undefined');
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  useEffect(() => {
    const node = targetRef.current;
    if (!enabled || !node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[entries.length - 1];
        if (entry) setInViewport(entry.isIntersecting && entry.intersectionRatio >= 0.25);
      },
      { threshold: 0.25 }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      // The next observer reports afresh; until then the element does not count as visible.
      setInViewport(false);
    };
  }, [enabled, targetRef]);

  return enabled && inViewport && pageVisible;
}

/**
 * Records that one evidence group was displayed (mission-panel-redesign plan §6.1): once `active`
 * has held for the two-second interval with the same `signature`, `onCovered(group, signature)`
 * runs. `active` must already fold in everything that makes the content truly on screen: its tab
 * is selected, its panel is in the foreground viewport, no dialog covers it, and its data is
 * complete. A changed signature, losing `active`, or unmounting cancels an unfinished interval.
 */
export function useEvidenceGroupCoverage({
  group,
  signature,
  active,
  onCovered
}: {
  group: string | null;
  signature: string | null;
  active: boolean;
  onCovered: (group: string, signature: string) => void;
}) {
  const onCoveredRef = useRef(onCovered);
  onCoveredRef.current = onCovered;
  useEffect(() => {
    if (!active || group === null || signature === null) return;
    const timer = setTimeout(
      () => onCoveredRef.current(group, signature),
      MISSION_SUMMARY_SEEN_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [active, group, signature]);
}

/**
 * Acknowledges one response's combined watermark once it has stayed due for two seconds (plan
 * §4.2a, §5.2). `due` comes from `summaryAcknowledgement`: every evidence group of that snapshot,
 * the summary header included, was displayed with its current signature, the target is backed by
 * displayed evidence and newer than the stored `seenAt` (ADR 0076, review R2). A new target starts
 * its own period; losing visibility or coverage, hiding the page, or unmounting cancels an
 * unfinished one. Never sends the wall-clock time, only a watermark the response carried.
 */
export function useAcknowledgeMissionSummary({
  missionId,
  target,
  due,
  visible
}: {
  missionId: string;
  /** The response's combined watermark (`summaryAcknowledgementTarget`). */
  target: string | null;
  /** `summaryAcknowledgement(...).due` for the same response. */
  due: boolean;
  /** The card is on screen in the foreground and not covered by a dialog. */
  visible: boolean;
}) {
  const markSeen = useMarkMissionSummarySeen(missionId);
  const mutateRef = useRef(markSeen.mutate);
  mutateRef.current = markSeen.mutate;
  const ready = due && visible && target !== null;

  useEffect(() => {
    if (!ready || target === null) return;
    const timer = setTimeout(() => mutateRef.current(target), MISSION_SUMMARY_SEEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, target]);
}
