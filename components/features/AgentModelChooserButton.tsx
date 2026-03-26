'use client';

import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState, useTransition } from 'react';

import {
  AgentModelSelector,
  useAgentModelPreference
} from '@/components/features/AgentModelSelector';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { type AgentModel, getAgentModelsAction } from '@/lib/actions/agent-models';
import { updateTicketAssignedAgentAction } from '@/lib/actions/tickets';
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import { getAgentTypeByValue } from '@/lib/helpers/agent-types';
import type { TicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { cn } from '@/lib/utils';

function getSelectionLabel(models: AgentModel[], modelId: string | null): string {
  if (!modelId) return 'Default model';
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
  initialSelection
}: {
  ticketId: string;
  initialSelection: TicketAssignedAgent | null;
}) {
  const { selection: preferenceSelection, setSelection: setPreferenceSelection } =
    useAgentModelPreference();
  const [models, setModels] = useState<AgentModel[]>([]);
  const [selection, setSelection] = useState<AgentModelSelection>(
    initialSelection ?? preferenceSelection
  );
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    getAgentModelsAction()
      .then(data => {
        if (!cancelled) {
          setModels(data);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextSelection = initialSelection ?? preferenceSelection;
    setSelection(current => (isSameSelection(current, nextSelection) ? current : nextSelection));
  }, [initialSelection, preferenceSelection]);

  const agent = getAgentTypeByValue(selection.agent);
  const label = getSelectionLabel(models, selection.model);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="h-8 gap-2 px-3 text-xs" size="sm" variant="outline">
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
      <PopoverContent align="start" className="w-auto min-w-[400px] p-3">
        <AgentModelSelector
          value={selection}
          onChange={nextSelection => {
            setSelection(nextSelection);
            setPreferenceSelection(nextSelection);
            startTransition(() => {
              void updateTicketAssignedAgentAction(ticketId, nextSelection);
            });
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
