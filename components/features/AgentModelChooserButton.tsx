'use client';

import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import {
  AgentModelSelector,
  useAgentModelPreference
} from '@/components/features/AgentModelSelector';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { type AgentModel, getAgentModelsAction } from '@/lib/actions/agent-models';
import { getAgentTypeByValue } from '@/lib/helpers/agent-types';

function getSelectionLabel(models: AgentModel[], modelId: string | null): string {
  if (!modelId) return 'Default model';
  return models.find(model => model.model_id === modelId)?.display_name ?? 'Selected model';
}

export function AgentModelChooserButton() {
  const { selection, setSelection } = useAgentModelPreference();
  const [models, setModels] = useState<AgentModel[]>([]);

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
            className="h-3.5 w-3.5"
          />
          <span>{label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto min-w-[400px] p-3">
        <AgentModelSelector value={selection} onChange={setSelection} />
      </PopoverContent>
    </Popover>
  );
}
