'use client';

import { Loader2 } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { updateAgentModelOfferingAction } from '@/lib/actions/admin-agent-models';
import type { AgentModel } from '@/lib/helpers/agent-model-catalog';
import { cn } from '@/lib/utils';

type Props = {
  initialModels: AgentModel[];
};

type ModelGroup = {
  agentType: string;
  offeredCount: number;
  totalCount: number;
  models: AgentModel[];
};

function formatAgentLabel(agentType: string): string {
  return agentType.charAt(0).toUpperCase() + agentType.slice(1);
}

export function AgentModelOfferingsPanel({ initialModels }: Props) {
  const [models, setModels] = useState(initialModels);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const groups = useMemo<ModelGroup[]>(() => {
    const grouped = new Map<string, AgentModel[]>();

    for (const model of models) {
      const current = grouped.get(model.agent_type) ?? [];
      current.push(model);
      grouped.set(model.agent_type, current);
    }

    return Array.from(grouped.entries()).map(([agentType, agentModels]) => ({
      agentType,
      offeredCount: agentModels.filter(model => model.is_offered).length,
      totalCount: agentModels.length,
      models: agentModels
    }));
  }, [models]);

  function handleToggle(model: AgentModel, checked: boolean) {
    setError(null);
    setPendingModelId(model.id);

    startTransition(() => {
      updateAgentModelOfferingAction(model.id, checked)
        .then(updatedModel => {
          setModels(current =>
            current.map(existing => (existing.id === updatedModel.id ? updatedModel : existing))
          );
        })
        .catch(error => {
          setError(error instanceof Error ? error.message : 'Failed to update model offering.');
        })
        .finally(() => {
          setPendingModelId(current => (current === model.id ? null : current));
        });
    });
  }

  return (
    <section className="rounded-[2rem] border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Model offerings</h2>
          <p className="text-sm text-muted-foreground">
            Set the default models offered to users. Members can further hide or reveal these in
            their own CLI settings, so this controls defaults rather than hard visibility.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">{models.length} synced models</div>
      </div>

      <div className="flex flex-col gap-6 p-6">
        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center text-sm text-muted-foreground">
            No synced models are available yet.
          </div>
        ) : (
          groups.map(group => (
            <div key={group.agentType} className="space-y-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {formatAgentLabel(group.agentType)}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {group.offeredCount} of {group.totalCount} currently offered
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-border">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="w-16 px-4 py-3 font-medium">Offer</th>
                      <th className="px-4 py-3 font-medium">Model</th>
                      <th className="px-4 py-3 font-medium">Thinking</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {group.models.map(model => {
                      const isSaving = pendingModelId === model.id && isPending;
                      return (
                        <tr key={model.id} className="align-top text-foreground/90">
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={model.is_offered}
                                disabled={isSaving}
                                onCheckedChange={checked => handleToggle(model, checked === true)}
                                aria-label={`Offer ${model.display_name}`}
                              />
                              {isSaving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="font-medium text-foreground">{model.display_name}</div>
                            <div className="mt-1 font-mono text-xs text-muted-foreground">
                              {model.model_id}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-xs text-muted-foreground">
                            {model.thinking_options.length > 0
                              ? model.thinking_options.join(', ')
                              : 'Default only'}
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={cn(
                                'inline-flex rounded-full px-2 py-1 text-[11px] font-medium',
                                model.is_offered
                                  ? 'bg-emerald-500/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
                              {model.is_offered ? 'Offered' : 'Hidden'}
                            </span>
                            {model.is_recommended ? (
                              <span className="ml-2 inline-flex rounded-full bg-sky-500/15 px-2 py-1 text-[11px] font-medium text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                                Recommended
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
