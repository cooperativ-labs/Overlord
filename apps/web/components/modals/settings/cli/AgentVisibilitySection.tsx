'use client';

import { useEffect, useState } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { getAllAgentConfigsAction, updateAgentVisibilityAction } from '@/lib/actions/agent-config';
import { type AgentModel, getAgentModelsAction } from '@/lib/actions/agent-models';
import { LAUNCH_AGENT_VALUES, type LaunchAgentType } from '@/lib/helpers/agent-types';

import { AgentNameWithLogo } from './AgentNameWithLogo';
import { AGENT_LABELS } from './cli-page-constants';

/**
 * Lets users choose which admin-offered agents and models appear in their model
 * selector. Admin offerings are the default set; hiding here is purely per-user.
 */
export function AgentVisibilitySection({ open }: { open: boolean }) {
  const [offeredModels, setOfferedModels] = useState<AgentModel[]>([]);
  const [hiddenAgents, setHiddenAgents] = useState<Record<string, boolean>>({});
  const [hiddenModels, setHiddenModels] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const [models, configs] = await Promise.all([
          getAgentModelsAction(),
          getAllAgentConfigsAction()
        ]);
        setOfferedModels(models);
        const nextHiddenAgents: Record<string, boolean> = {};
        const nextHiddenModels: Record<string, string[]> = {};
        Object.entries(configs).forEach(([agentType, config]) => {
          if (config.hidden) nextHiddenAgents[agentType] = true;
          if (config.hiddenModels?.length) nextHiddenModels[agentType] = config.hiddenModels;
        });
        setHiddenAgents(nextHiddenAgents);
        setHiddenModels(nextHiddenModels);
      } catch (error) {
        console.error('Failed to load agent visibility:', error);
      }
    })();
  }, [open]);

  const modelsByAgent = offeredModels.reduce<Record<string, AgentModel[]>>((grouped, model) => {
    (grouped[model.agent_type] ??= []).push(model);
    return grouped;
  }, {});

  async function toggleAgent(agent: LaunchAgentType, show: boolean) {
    setHiddenAgents(current => ({ ...current, [agent]: !show }));
    try {
      await updateAgentVisibilityAction(agent, { hidden: !show });
    } catch (error) {
      console.error('Failed to update agent visibility:', error);
    }
  }

  function toggleModel(agent: LaunchAgentType, modelId: string, show: boolean) {
    setHiddenModels(current => {
      const existing = current[agent] ?? [];
      const next = show ? existing.filter(id => id !== modelId) : [...existing, modelId];
      void updateAgentVisibilityAction(agent, { hiddenModels: next }).catch(error =>
        console.error('Failed to update model visibility:', error)
      );
      return { ...current, [agent]: next };
    });
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Available agents & models</p>
        <p className="text-xs text-muted-foreground">
          Choose which agents and models appear in your model selector. Your admin sets the
          defaults; hiding here only affects your account.
        </p>
      </div>
      <Accordion type="multiple" className="flex flex-col gap-2">
        {LAUNCH_AGENT_VALUES.map(agent => {
          const agentModels = modelsByAgent[agent] ?? [];
          const agentShown = !hiddenAgents[agent];
          const hidden = hiddenModels[agent] ?? [];
          return (
            <AccordionItem
              key={agent}
              value={agent}
              className="rounded-md border bg-muted/30 px-3 last:border-b"
            >
              <AccordionTrigger className="hover:no-underline">
                <div className="flex w-full items-center justify-between gap-3 pr-2">
                  <span className="text-xs font-medium">
                    <AgentNameWithLogo agent={agent} label={AGENT_LABELS[agent] ?? agent} />
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {agentShown ? 'Shown' : 'Hidden'}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid gap-3">
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={agentShown}
                      onCheckedChange={checked => void toggleAgent(agent, checked === true)}
                    />
                    Show this agent in my selector
                  </label>
                  {agentModels.length > 0 ? (
                    <div className="grid gap-1.5">
                      <p className="text-[11px] font-medium text-muted-foreground">Models</p>
                      {agentModels.map(model => (
                        <label key={model.model_id} className="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={!hidden.includes(model.model_id)}
                            disabled={!agentShown}
                            onCheckedChange={checked =>
                              toggleModel(agent, model.model_id, checked === true)
                            }
                          />
                          <span className="truncate">{model.display_name}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      No models offered for this agent.
                    </p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
