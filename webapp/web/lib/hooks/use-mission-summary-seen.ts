import type { MissionSummaryResponse } from '@overlord/contract';
import { type RefObject, useEffect, useRef, useState } from 'react';

import { watermarkNeedsAck } from '../mission-summary-derive.ts';
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
    return () => observer.disconnect();
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
 * Acknowledges the watermark of the evidence on screen once it has stayed visible for two
 * seconds (plan §4.2a, §5.2), and only when every evidence group of that snapshot has been
 * displayed (`coverageComplete`, mission-panel-redesign plan §6.1). A new watermark starts its
 * own period; losing visibility, losing coverage, hiding the page, or unmounting cancels an
 * unfinished one. Never sends the wall-clock time, only the response's `watermark`, and only when
 * it is newer than the stored `seenAt`, so the stored meaning of `seenAt` is unchanged.
 */
export function useAcknowledgeMissionSummary({
  missionId,
  response,
  displayed,
  visible,
  coverageComplete
}: {
  missionId: string;
  response: MissionSummaryResponse | undefined;
  /** The card is rendering this response's evidence (not loading, partial or failed). */
  displayed: boolean;
  /** The header/source evidence is on screen in the foreground and not covered by a dialog. */
  visible: boolean;
  /** Every nonempty evidence group of this snapshot has been displayed during this visit. */
  coverageComplete: boolean;
}) {
  const markSeen = useMarkMissionSummarySeen(missionId);
  const mutateRef = useRef(markSeen.mutate);
  mutateRef.current = markSeen.mutate;

  const watermark = response?.eligible ? response.watermark : null;
  const seenAt = response?.eligible ? response.seenAt : null;
  const due = displayed && visible && coverageComplete && watermarkNeedsAck(watermark, seenAt);

  useEffect(() => {
    if (!due || watermark === null) return;
    const timer = setTimeout(() => mutateRef.current(watermark), MISSION_SUMMARY_SEEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [due, watermark]);
}
