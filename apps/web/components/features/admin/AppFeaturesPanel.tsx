'use client';

import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Textarea } from '@/components/ui/textarea';
import { createAppFeatureAction, updateAppFeatureAction } from '@/lib/actions/admin-features';
import type { AppFeatureDefinition } from '@/lib/app-features';
import { cn } from '@/lib/utils';

type Props = {
  initialFeatures: AppFeatureDefinition[];
};

type CreateFeatureFormState = {
  description: string;
  isEnabled: boolean;
  key: string;
  name: string;
};

const DEFAULT_CREATE_FORM: CreateFeatureFormState = {
  description: '',
  isEnabled: true,
  key: '',
  name: ''
};

function sortFeatures(features: AppFeatureDefinition[]): AppFeatureDefinition[] {
  return [...features].sort((left, right) => left.key.localeCompare(right.key));
}

export function AppFeaturesPanel({ initialFeatures }: Props) {
  const [features, setFeatures] = useState(() => sortFeatures(initialFeatures));
  const [createForm, setCreateForm] = useState<CreateFeatureFormState>(DEFAULT_CREATE_FORM);
  const [createButtonState, setCreateButtonState] = useState<ButtonLoadingState>('default');
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateCreateForm<Field extends keyof CreateFeatureFormState>(
    field: Field,
    value: CreateFeatureFormState[Field]
  ) {
    setCreateForm(current => ({ ...current, [field]: value }));
  }

  async function handleCreateFeature() {
    setError(null);
    setCreateButtonState('loading');

    try {
      const created = await createAppFeatureAction(createForm);
      setFeatures(current =>
        sortFeatures([...current.filter(feature => feature.key !== created.key), created])
      );
      setCreateForm(DEFAULT_CREATE_FORM);
      setCreateButtonState('success');
    } catch (error) {
      setCreateButtonState('error');
      setError(error instanceof Error ? error.message : 'Failed to create feature flag.');
    }
  }

  function handleToggle(feature: AppFeatureDefinition, checked: boolean) {
    setError(null);
    setPendingKey(feature.key);

    startTransition(() => {
      updateAppFeatureAction(feature.key, checked)
        .then(updated => {
          setFeatures(current =>
            current.map(existing => (existing.key === updated.key ? updated : existing))
          );
        })
        .catch(error => {
          setError(error instanceof Error ? error.message : 'Failed to update feature flag.');
        })
        .finally(() => {
          setPendingKey(current => (current === feature.key ? null : current));
        });
    });
  }

  return (
    <section className="rounded-[2rem] border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Feature flags</h2>
          <p className="text-sm text-muted-foreground">
            Show or hide tagged product features across the web and desktop apps.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">{features.length} total</div>
      </div>

      <div className="flex flex-col gap-4 p-6">
        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="rounded-2xl border border-border bg-muted/40 p-5">
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Create feature flag</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Add a new toggleable feature entry for future product rollouts.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="feature-key">Feature key</Label>
                <Input
                  id="feature-key"
                  placeholder="ex: desktop-beta"
                  value={createForm.key}
                  onChange={event => updateCreateForm('key', event.target.value)}
                />
                <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="feature-name">Feature name</Label>
                <Input
                  id="feature-name"
                  placeholder="Desktop beta"
                  value={createForm.name}
                  onChange={event => updateCreateForm('name', event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="feature-description">Description</Label>
              <Textarea
                id="feature-description"
                placeholder="Describe where this flag should show or hide behavior."
                value={createForm.description}
                onChange={event => updateCreateForm('description', event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <label className="flex items-center gap-3 text-sm text-foreground">
                <Checkbox
                  checked={createForm.isEnabled}
                  onCheckedChange={checked => updateCreateForm('isEnabled', checked === true)}
                  aria-label="Enable feature immediately"
                />
                Enable immediately
              </label>

              <LoadingButton
                buttonState={createButtonState}
                setButtonState={setCreateButtonState}
                text="Create feature"
                loadingText="Creating feature..."
                successText="Feature created"
                errorText="Create failed"
                reset
                onClick={handleCreateFeature}
              />
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="w-20 px-4 py-3 font-medium">Show</th>
                <th className="px-4 py-3 font-medium">Feature</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {features.map(feature => {
                const isSaving = pendingKey === feature.key && isPending;
                return (
                  <tr key={feature.key} className="align-top text-foreground/90">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={feature.isEnabled}
                          disabled={isSaving}
                          onCheckedChange={checked => handleToggle(feature, checked === true)}
                          aria-label={`Show ${feature.name}`}
                        />
                        {isSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-foreground">{feature.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{feature.description}</div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-1 text-[11px] font-medium',
                          feature.isEnabled
                            ? 'bg-emerald-500/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {feature.isEnabled ? 'Visible' : 'Hidden'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
