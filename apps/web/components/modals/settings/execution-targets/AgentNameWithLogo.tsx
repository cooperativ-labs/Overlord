import { AgentIcon } from '@/components/features/AgentIcon';
import { getAgentTypeByValue, type LaunchAgentType } from '@/lib/helpers/agent-types';

import { COPY_AGENT_LABELS } from './execution-targets-helpers';

export function AgentNameWithLogo({
  agent,
  label,
  iconClassName = 'h-4 w-4'
}: {
  agent: string;
  label: string;
  iconClassName?: string;
}) {
  if (agent in COPY_AGENT_LABELS) {
    return <span>{label}</span>;
  }

  const agentType = getAgentTypeByValue(agent as LaunchAgentType);

  return (
    <span className="flex items-center gap-2">
      <AgentIcon agentType={agentType} size={16} className={iconClassName} />
      <span>{label}</span>
    </span>
  );
}
