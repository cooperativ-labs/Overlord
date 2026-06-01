'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { getCustomAgentsAction, saveCustomAgentsAction } from '@/lib/actions/agent-config';
import { extractTemplateTokens } from '@/lib/helpers/custom-agent';
import type { CustomAgent, CustomAgentPlaceholder } from '@/lib/schemas/agent-config';

import {
  emptyDraft,
  parseOptionsText,
  placeholdersToOptionsText,
  slugify
} from './cli-page-helpers';
import type { CustomAgentDraft } from './cli-page-types';
import { RobotAgentLabel } from './RobotAgentLabel';

/**
 * CRUD UI for user-defined custom agents. Each agent maps a launch-command
 * template (with `{{token}}` placeholders) to predefined option sets that drive
 * the model/effort columns of the shared model selector.
 */
export function CustomAgentsSection({ open }: { open: boolean }) {
  const [customAgents, setCustomAgents] = useState<CustomAgent[]>([]);
  const [draft, setDraft] = useState<CustomAgentDraft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        setCustomAgents(await getCustomAgentsAction());
      } catch (error) {
        console.error('Failed to load custom agents:', error);
      }
    })();
  }, [open]);

  const detectedTokens = draft ? extractTemplateTokens(draft.commandTemplate) : [];

  function startCreate() {
    setDraft(emptyDraft());
  }

  function startEdit(agent: CustomAgent) {
    const placeholders: CustomAgentDraft['placeholders'] = {};
    for (const placeholder of agent.placeholders) {
      placeholders[placeholder.token] = {
        label: placeholder.label,
        role: placeholder.role,
        optionsText: placeholdersToOptionsText(placeholder)
      };
    }
    setDraft({
      id: agent.id,
      name: agent.name,
      commandTemplate: agent.commandTemplate,
      placeholders
    });
  }

  function updateDraftPlaceholder(
    token: string,
    patch: Partial<{ label: string; role: CustomAgentPlaceholder['role']; optionsText: string }>
  ) {
    setDraft(current => {
      if (!current) return current;
      const existing = current.placeholders[token] ?? {
        label: token,
        role: 'other',
        optionsText: ''
      };
      return {
        ...current,
        placeholders: { ...current.placeholders, [token]: { ...existing, ...patch } }
      };
    });
  }

  async function persist(nextAgents: CustomAgent[]) {
    setSaving(true);
    try {
      const saved = await saveCustomAgentsAction(nextAgents);
      setCustomAgents(saved);
      setDraft(null);
    } catch (error) {
      console.error('Failed to save custom agents:', error);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft() {
    if (!draft) return;
    const name = draft.name.trim();
    const commandTemplate = draft.commandTemplate.trim();
    if (!name || !commandTemplate) return;
    const id = draft.id || `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
    const placeholders: CustomAgentPlaceholder[] = detectedTokens.map(token => {
      const fields = draft.placeholders[token] ?? { label: token, role: 'other', optionsText: '' };
      return {
        token,
        label: fields.label.trim() || token,
        role: fields.role,
        options: parseOptionsText(fields.optionsText)
      };
    });
    const nextAgent: CustomAgent = { id, name, commandTemplate, placeholders };
    const others = customAgents.filter(agent => agent.id !== id);
    await persist([...others, nextAgent]);
  }

  async function handleDelete(id: string) {
    await persist(customAgents.filter(agent => agent.id !== id));
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Custom agents</p>
        <p className="text-xs text-muted-foreground">
          Define your own agents by mapping a launch command to predefined options. Use{' '}
          <code className="rounded bg-muted px-1">{'{{token}}'}</code> placeholders, e.g.{' '}
          <code className="rounded bg-muted px-1">
            ollama claude {'{{model}}'} --effort {'{{effort}}'}
          </code>
          , then set the options for each token. They appear in your model selector with a robot
          icon.
        </p>
      </div>

      {customAgents.length > 0 ? (
        <div className="grid gap-2">
          {customAgents.map(agent => (
            <div
              key={agent.id}
              className="flex items-start justify-between gap-3 rounded-md border bg-background p-3"
            >
              <div className="grid gap-1">
                <p className="text-xs font-medium">
                  <RobotAgentLabel name={agent.name} />
                </p>
                <code className="break-all text-[11px] text-muted-foreground">
                  {agent.commandTemplate}
                </code>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button type="button" variant="outline" size="sm" onClick={() => startEdit(agent)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(agent.id)}
                  aria-label={`Delete ${agent.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {draft ? (
        <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">Name</label>
            <input
              type="text"
              value={draft.name}
              placeholder="e.g., Claude via Ollama"
              onChange={e =>
                setDraft(current => (current ? { ...current, name: e.target.value } : current))
              }
              className="w-full rounded border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">Launch command template</label>
            <input
              type="text"
              value={draft.commandTemplate}
              placeholder="ollama claude {{model}} --effort {{effort}}"
              onChange={e =>
                setDraft(current =>
                  current ? { ...current, commandTemplate: e.target.value } : current
                )
              }
              className="w-full rounded border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {detectedTokens.length > 0 ? (
            <div className="grid gap-2">
              <p className="text-[11px] font-medium text-muted-foreground">Placeholders</p>
              {detectedTokens.map(token => {
                const fields = draft.placeholders[token] ?? {
                  label: token,
                  role: 'other' as const,
                  optionsText: ''
                };
                return (
                  <div key={token} className="grid gap-2 rounded-md border bg-background p-2">
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-muted px-1 text-[11px]">{`{{${token}}}`}</code>
                      <input
                        type="text"
                        value={fields.label}
                        placeholder="Label"
                        onChange={e => updateDraftPlaceholder(token, { label: e.target.value })}
                        className="flex-1 rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <Select
                        value={fields.role}
                        onValueChange={value =>
                          updateDraftPlaceholder(token, {
                            role: value as CustomAgentPlaceholder['role']
                          })
                        }
                      >
                        <SelectTrigger className="w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="model">Model</SelectItem>
                          <SelectItem value="thinking">Effort</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <textarea
                      value={fields.optionsText}
                      placeholder={'Options, one per line\nvalue | Label'}
                      onChange={e => updateDraftPlaceholder(token, { optionsText: e.target.value })}
                      rows={3}
                      className="w-full rounded border bg-background px-2 py-1 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Add <code className="rounded bg-muted px-1">{'{{token}}'}</code> placeholders to the
              template to configure their options.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={saving || !draft.name.trim() || !draft.commandTemplate.trim()}
              onClick={() => void handleSaveDraft()}
            >
              {saving ? 'Saving…' : 'Save agent'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 justify-self-start"
          onClick={startCreate}
        >
          <Plus className="h-3.5 w-3.5" />
          Add custom agent
        </Button>
      )}
    </div>
  );
}
