import { AgentIcon } from '@/components/features/AgentIcon';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';

type FeedCardAgentBadgeProps = {
  agentIdentifier: string | null;
  state: string;
};

export function FeedCardAgentBadge({ agentIdentifier, state }: FeedCardAgentBadgeProps) {
  const agentType = getAgentTypeByIdentifier(agentIdentifier);
  const lower = state.toLowerCase();
  const isExecuting = lower === 'executing';

  if (agentType) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted p-0.5 text-[10px] font-semibold text-muted-foreground">
        <AgentIcon agentType={agentType} size={10} />
        {/* {agentType.label} */}
        {isExecuting ? (
          <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
        ) : null}
      </span>
    );
  }

  if (lower === 'executing') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-300">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
        RUN
      </span>
    );
  }

  if (lower === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        DONE
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
      {state.toUpperCase()}
    </span>
  );
}
