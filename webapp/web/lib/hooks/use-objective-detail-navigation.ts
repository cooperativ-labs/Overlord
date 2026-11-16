import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  isLocallyPushedObjectiveDetail,
  OBJECTIVE_DETAIL_HISTORY_KEY,
  objectiveSearchFromLocation,
  withObjectiveSearch,
  withoutObjectiveSearch
} from '../mission-panel-search.ts';

/**
 * The ref a close is navigating away from. Until the router reflects that close, a clean-up of an
 * "invalid" ref (the objective was just deleted) must not race it with a second navigation.
 */
let closingRef: string | null = null;

type SearchUpdater = (previous: Record<string, unknown>) => Record<string, unknown>;
type StateUpdater = (previous: Record<string, unknown>) => Record<string, unknown>;

export type ObjectiveDetailNavigation = {
  /** The `?objective=` ref in the URL (display id or UUID), if any. */
  currentRef: string | undefined;
  /** Whether the current detail entry was pushed by this UI over the mission-only entry. */
  locallyPushed: boolean;
  /**
   * Open an objective's detail. From the mission alone this pushes one detail entry (so browser
   * Back reveals the mission); when a detail is already open it replaces that entry.
   */
  open: (ref: string) => void;
  /** Previous/next: replace the current detail entry, keeping how it was entered. */
  step: (ref: string) => void;
  /**
   * Explicit Close: reveal the mission. A locally pushed entry goes back to the mission-only
   * entry beneath it; a direct, copied or feed link is replaced with the mission-only URL, so no
   * obsolete detail entry is left for Back to reopen. No mission entry is ever synthesized.
   */
  close: () => void;
  /** Drop an `?objective=` ref that names no objective of the loaded mission (replace). */
  clearInvalid: () => void;
};

/**
 * The one navigation helper for the objective detail (mission-panel-redesign plan §9.1): rows,
 * summary links, blocking-question cards and the detail's own controls all open, step and close
 * through it, so every in-panel entry point has the same push/replace/back behaviour.
 */
export function useObjectiveDetailNavigation(): ObjectiveDetailNavigation {
  const navigate = useNavigate();
  const router = useRouter();
  // Read the live history entry (its search and its state marker) rather than the router's
  // resolved match state: a search-only change and its history state are known as soon as the
  // entry is pushed or popped, independent of route matching.
  const history = router.history;
  const subscribe = useCallback((listener: () => void) => history.subscribe(listener), [history]);
  const readRef = () => {
    const raw = history.location.search;
    // Parse exactly as the router does (its search serializer), then apply the panel's rules.
    const parse = router.options.parseSearch;
    return objectiveSearchFromLocation(parse ? parse(raw) : raw);
  };
  const currentRef = useSyncExternalStore(subscribe, readRef, readRef);
  const locallyPushed = useSyncExternalStore(
    subscribe,
    () => isLocallyPushedObjectiveDetail(history.location.state),
    () => isLocallyPushedObjectiveDetail(history.location.state)
  );

  const go = useCallback(
    (search: SearchUpdater, { replace, pushed }: { replace: boolean; pushed: boolean }) => {
      const state: StateUpdater = previous => ({
        ...previous,
        [OBJECTIVE_DETAIL_HISTORY_KEY]: pushed
      });
      void navigate({
        to: '.',
        search: search as never,
        state: state as never,
        replace
      });
    },
    [navigate]
  );

  const open = useCallback(
    (ref: string) => {
      closingRef = null;
      if (currentRef === ref) return;
      if (currentRef) {
        go(previous => withObjectiveSearch(previous, ref), {
          replace: true,
          pushed: locallyPushed
        });
        return;
      }
      go(previous => withObjectiveSearch(previous, ref), { replace: false, pushed: true });
    },
    [currentRef, go, locallyPushed]
  );

  const step = useCallback(
    (ref: string) => {
      closingRef = null;
      if (currentRef === ref) return;
      go(previous => withObjectiveSearch(previous, ref), {
        replace: true,
        pushed: locallyPushed
      });
    },
    [currentRef, go, locallyPushed]
  );

  const close = useCallback(() => {
    if (!currentRef) return;
    closingRef = currentRef;
    if (locallyPushed) {
      router.history.back();
      return;
    }
    go(withoutObjectiveSearch, { replace: true, pushed: false });
  }, [currentRef, go, locallyPushed, router]);

  const clearInvalid = useCallback(() => {
    if (!currentRef || closingRef === currentRef) return;
    go(withoutObjectiveSearch, { replace: true, pushed: false });
  }, [currentRef, go]);

  return useMemo(
    () => ({ currentRef, locallyPushed, open, step, close, clearInvalid }),
    [clearInvalid, close, currentRef, locallyPushed, open, step]
  );
}
