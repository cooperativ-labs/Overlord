import { type RefObject, useEffect, useRef, useState } from 'react';

import type { MissionSummaryResponse } from '../../../shared/contract.ts';
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

function useElementVisible(targetRef: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [inViewport, setInViewport] = useState(true);
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
        if (entry) setInViewport(entry.isIntersecting);
      },
      { threshold: 0.25 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, targetRef]);

  return inViewport && pageVisible;
}

/**
 * Acknowledges the watermark of the evidence on screen once it has stayed
 * visible for two seconds (plan §4.2a, §5.2). A new watermark starts its own
 * period; leaving the viewport, hiding the page, or unmounting cancels an
 * unfinished one. Never sends the wall-clock time, only the response's
 * `watermark`, and only when it is newer than the stored `seenAt`.
 */
export function useAcknowledgeMissionSummary({
  missionId,
  response,
  displayed,
  targetRef
}: {
  missionId: string;
  response: MissionSummaryResponse | undefined;
  /** The section is rendering this response's evidence. */
  displayed: boolean;
  targetRef: RefObject<HTMLElement | null>;
}) {
  const markSeen = useMarkMissionSummarySeen(missionId);
  const mutateRef = useRef(markSeen.mutate);
  mutateRef.current = markSeen.mutate;
  const visible = useElementVisible(targetRef, displayed);

  const watermark = response?.eligible ? response.watermark : null;
  const seenAt = response?.eligible ? response.seenAt : null;
  const due = displayed && visible && watermarkNeedsAck(watermark, seenAt);

  useEffect(() => {
    if (!due || watermark === null) return;
    const timer = setTimeout(() => mutateRef.current(watermark), MISSION_SUMMARY_SEEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [due, watermark]);
}
