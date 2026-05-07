'use client';

import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState, useTransition } from 'react';

import {
  AgentModelSelector,
  useAgentModelPreference,
  useAgentModels
} from '@/components/features/AgentModelSelector';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AgentModel } from '@/lib/actions/agent-models';
import { updateTicketAssignedAgentAction } from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import { getAgentTypeByValue } from '@/lib/helpers/agent-types';
import type { TicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { cn } from '@/lib/utils';

const updateTicketAssignedAgentActionWithRetry = withElectronActionRetry(
  updateTicketAssignedAgentAction
);

function getSelectionLabel(models: AgentModel[], modelId: string | null): string {
  if (!modelId) return 'Default model';
  if (modelId === 'auto') return 'Auto';
  const name = models.find(model => model.model_id === modelId)?.display_name ?? 'Selected model';
  return name.replace(/^Claude\s+/i, '');
}

function isSameSelection(left: AgentModelSelection, right: AgentModelSelection): boolean {
  return (
    left.agent === right.agent && left.model === right.model && left.thinking === right.thinking
  );
}

export function AgentModelChooserButton({
  ticketId,
  objectiveId,
  initialSelection,
  disabled = false,
  onSelectionChange,
  persistSelection = true
}: {
  ticketId?: string | null;
  objectiveId?: string | null;
  initialSelection: TicketAssignedAgent | null;
  disabled?: boolean;
  onSelectionChange?: (selection: AgentModelSelection) => void;
  persistSelection?: boolean;
}) {
  const { selection: preferenceSelection, setSelection: setPreferenceSelection } =
    useAgentModelPreference();
  const { models } = useAgentModels();
  const [selection, setSelection] = useState<AgentModelSelection>(
    initialSelection ?? preferenceSelection
  );
  const [, startTransition] = useTransition();

  useEffect(() => {
    const nextSelection = initialSelection ?? preferenceSelection;
    setSelection(current => (isSameSelection(current, nextSelection) ? current : nextSelection));
  }, [initialSelection, preferenceSelection]);

  const agent = getAgentTypeByValue(selection.agent);
  const label = getSelectionLabel(models, selection.model);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="h-8 gap-2 px-3 text-xs" size="sm" variant="outline" disabled={disabled}>
          <Image
            src={agent.icon}
            alt={`${agent.label} icon`}
            width={14}
            height={14}
            className={cn('h-3.5 w-3.5', agent.invertDark ? 'dark:invert' : '')}
          />
          <span>{label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={{ left: 8, right: 8 }}
        className="w-auto min-w-[320px] p-2"
      >
        <AgentModelSelector
          value={selection}
          onChange={nextSelection => {
            setSelection(nextSelection);
            setPreferenceSelection(nextSelection);
            onSelectionChange?.(nextSelection);
            if (persistSelection && ticketId) {
              startTransition(() => {
                void updateTicketAssignedAgentActionWithRetry(ticketId, nextSelection, objectiveId);
              });
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
