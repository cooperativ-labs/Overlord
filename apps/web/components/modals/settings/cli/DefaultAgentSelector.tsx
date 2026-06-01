'use client';

import {
  AgentModelSelector,
  useAgentModelPreference
} from '@/components/features/AgentModelSelector';

export function DefaultAgentSelector() {
  const { selection, setSelection, selectAgent, configs } = useAgentModelPreference();

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <AgentModelSelector
        value={selection}
        onChange={setSelection}
        onAgentSelect={selectAgent}
        userConfigs={configs}
      />
    </div>
  );
}
