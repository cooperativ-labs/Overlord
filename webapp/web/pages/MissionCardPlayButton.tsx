import { nextUpDraft } from '@overlord/automations/objective-manager';
import type { MissionDto } from '@overlord/contract';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Play } from 'lucide-react';

import { MANUAL_AGENT_KEY } from '@/components/objectives/AgentModelSelector.tsx';
import { resolveObjectiveAgentSelection } from '@/components/objectives/useObjectiveAgentSelection.ts';
import {
  agentCatalogQueryOptions,
  launchPreferenceQueryOptions,
  useLaunchObjective
} from '@/lib/queries/agent-launch-config.ts';
import { missionQueryOptions } from '@/lib/queries/missions.ts';

const noDraftMessage = 'No draft objective with instructions.';

export function MissionCardPlayButton({
  mission
}: {
  mission: Pick<MissionDto, 'id' | 'hasPendingObjectiveWithInstructions'>;
}) {
  const client = useQueryClient();
  const { mutateAsync: launchObjective } = useLaunchObjective();
  const launchNextDraft = useMutation({
    mutationFn: async () => {
      // Read the current queue only on activation, including any changes since the board loaded.
      const detail = await client.fetchQuery({ ...missionQueryOptions(mission.id), staleTime: 0 });
      const objective = nextUpDraft(detail.objectives);
      if (!objective) throw new Error(noDraftMessage);

      const preference = objective.assignedAgent
        ? null
        : await client.fetchQuery(launchPreferenceQueryOptions(detail.projectId));
      const catalog =
        objective.assignedAgent || preference?.selectedAgent
          ? null
          : await client.fetchQuery(agentCatalogQueryOptions(detail.workspaceId));
      const selection = resolveObjectiveAgentSelection(objective, preference, catalog);
      if (selection.agent === MANUAL_AGENT_KEY) {
        throw new Error('Choose an agent on the objective before running it.');
      }

      await launchObjective({
        id: objective.id,
        body: {
          agent: selection.agent,
          model: selection.model,
          reasoningEffort: selection.reasoningEffort
        }
      });
    }
  });
  const disabled = !mission.hasPendingObjectiveWithInstructions || launchNextDraft.isPending;
  const label = launchNextDraft.isPending
    ? 'Launching draft objective'
    : 'Launch next draft objective';
  const error = launchNextDraft.error?.message;

  return (
    <>
      {error ? (
        <span role="alert" className="max-w-28 truncate text-[10px] text-destructive" title={error}>
          {error}
        </span>
      ) : null}
      <button
        type="button"
        aria-label={label}
        title={mission.hasPendingObjectiveWithInstructions ? label : noDraftMessage}
        aria-disabled={disabled}
        onClick={event => {
          event.stopPropagation();
          if (!disabled) launchNextDraft.mutate();
        }}
        onPointerDown={event => event.stopPropagation()}
        onKeyDown={event => event.stopPropagation()}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-transparent text-muted-foreground transition-colors aria-disabled:opacity-50 aria-[disabled=false]:hover:border-emerald-500/40 aria-[disabled=false]:hover:bg-emerald-500/15 aria-[disabled=false]:hover:text-emerald-500"
      >
        {launchNextDraft.isPending ? (
          <LoaderCircle className="h-3 w-3 animate-spin" />
        ) : (
          <Play className="h-3 w-3 fill-current" />
        )}
      </button>
    </>
  );
}
