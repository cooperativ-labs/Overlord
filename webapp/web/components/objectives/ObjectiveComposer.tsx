import type { MissionDetailDto, ObjectiveDto } from '@overlord/contract';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ComposerSavedObjective } from './ComposerSavedObjective.tsx';
import { GhostObjective } from './GhostObjective.tsx';

/** States in which a saved objective stays in the composer; once it runs it joins the list. */
const COMPOSER_HELD_STATES = new Set<ObjectiveDto['state']>(['draft', 'submitted', 'launching']);

type ObjectiveComposerProps = {
  mission: MissionDetailDto;
  /**
   * Reports the objective the composer holds — while it is being created and then while it is
   * shown saved in the composer — and `null` once it belongs to the objective list. The mission
   * panel hides that id from the list meanwhile, so it is never shown twice.
   */
  onHeldObjectiveChange?: (objectiveId: string | null) => void;
};

/**
 * The mission panel's objective composer (coo:1289).
 *
 * 1. An unsaved {@link GhostObjective} with Save in the Run slot. Save, Cmd/Ctrl+Enter or leaving
 *    the card creates the objective.
 * 2. The saved objective then stays here as {@link ComposerSavedObjective} — the full saved
 *    toolbar with the green Run — and is not added to the objective list yet.
 * 3. It joins the list when the person leaves the mission panel (the composer unmounts and the
 *    held id goes with it) or clicks "+ Add objective", which also presents a fresh composer.
 *
 * A held objective that is deleted, or that starts executing, is released to the list
 * automatically and a fresh composer takes its place.
 */
export function ObjectiveComposer({ mission, onHeldObjectiveChange }: ObjectiveComposerProps) {
  /** Bumped for every fresh composer, so it never inherits the previous buffer. */
  const [generation, setGeneration] = useState(0);
  /** The objective the ghost created, used until the mission refetch includes it. */
  const [created, setCreated] = useState<ObjectiveDto | null>(null);
  /** The mission's objective list has included the created objective at least once. */
  const [seenInMission, setSeenInMission] = useState(false);
  const callbackRef = useRef(onHeldObjectiveChange);
  callbackRef.current = onHeldObjectiveChange;
  const unmountedRef = useRef(false);
  /** Report to the panel, but never after unmount: a late ghost commit must not hide a row. */
  const report = useCallback((objectiveId: string | null) => {
    if (!unmountedRef.current) callbackRef.current?.(objectiveId);
  }, []);

  const live = created ? (mission.objectives.find(o => o.id === created.id) ?? null) : null;
  useEffect(() => {
    if (live && !seenInMission) setSeenInMission(true);
  }, [live, seenInMission]);
  const held = live ?? (created && !seenInMission ? created : null);

  /** Hand the held objective to the list and present a fresh composer. */
  const release = useCallback(() => {
    setSeenInMission(false);
    setCreated(null);
    report(null);
    setGeneration(value => value + 1);
  }, [report]);

  // Deleted from its menu (gone after the mission listed it) or started executing elsewhere.
  const deleted = created !== null && live === null && seenInMission;
  const started = live !== null && !COMPOSER_HELD_STATES.has(live.state);
  useEffect(() => {
    if (deleted || started) release();
  }, [deleted, started, release]);

  // The held id belongs to this composer only; never leave it hidden behind a mission switch.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      callbackRef.current?.(null);
      unmountedRef.current = true;
    };
  }, []);

  if (held && !deleted && !started) {
    return (
      <div className="flex flex-col gap-2" data-testid="objective-composer">
        <ComposerSavedObjective objective={held} mission={mission} onDeleted={release} />
        <button
          type="button"
          className="inline-flex w-fit items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/60"
          onClick={release}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add objective
        </button>
      </div>
    );
  }

  return (
    <div data-testid="objective-composer">
      <GhostObjective
        key={generation}
        missionId={mission.id}
        projectId={mission.projectId}
        autoFocus={generation > 0}
        // A null here is the ghost's own hand-over; the objective stays held as the saved card.
        onCommittingChange={id => {
          if (id !== null) report(id);
        }}
        onMaterialized={objective => {
          setSeenInMission(false);
          setCreated(objective);
        }}
      />
    </div>
  );
}
