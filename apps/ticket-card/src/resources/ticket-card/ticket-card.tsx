import { useEffect, useState } from 'react';
import type { ResourceConfig } from 'sunpeak';
import {
  SafeArea,
  useCallServerTool,
  useDisplayMode,
  useLocale,
  usePlatform,
  useToolData,
  useUpdateModelContext
} from 'sunpeak';

type Priority = 'low' | 'medium' | 'high' | 'urgent';

type CreateTicketDraftInput = {
  conversationContext: string;
  title?: string;
  description?: string;
  priority?: Priority;
  projectId?: string;
};

type DraftPayload = {
  draft?: {
    title?: string;
    description?: string;
    priority?: Priority;
    projectId?: string | null;
    projectName?: string | null;
    sourceSummary?: string;
  };
  ticketCard?: {
    saveToolName?: string;
    resourceUri?: string;
  };
  ticket?: {
    id: string;
    reference: string;
    title: string;
    projectName?: string | null;
  };
};

type TicketDraft = {
  title: string;
  description: string;
  priority: Priority;
  projectId: string | null;
  projectName: string | null;
  sourceSummary: string;
};

const PRIORITY_OPTIONS: Array<{ value: Priority; label: string; hint: string }> = [
  { value: 'low', label: 'Low', hint: 'Backlog or nice-to-have work.' },
  { value: 'medium', label: 'Medium', hint: 'Normal planning priority.' },
  { value: 'high', label: 'High', hint: 'Important work with clear urgency.' },
  { value: 'urgent', label: 'Urgent', hint: 'Blocker or immediate attention required.' }
];

const EMPTY_DRAFT: TicketDraft = {
  title: '',
  description: '',
  priority: 'medium',
  projectId: null,
  projectName: null,
  sourceSummary: ''
};

export const resource: ResourceConfig = {
  title: 'Overlord Ticket Card',
  description: 'Review and edit a drafted Overlord ticket before saving it from chat.',
  mimeType: 'text/html;profile=mcp-app',
  _meta: {
    ui: {
      csp: {
        connectDomains: [],
        resourceDomains: []
      }
    },
    'openai/widgetDescription':
      'Review and edit a drafted Overlord ticket before saving it from chat.',
    'openai/widgetPrefersBorder': true,
    'openai/widgetCSP': {
      connect_domains: [],
      resource_domains: []
    }
  }
};

function summarizeConversation(text: string | undefined) {
  return text?.replace(/\s+/g, ' ').trim().slice(0, 140) ?? '';
}

function extractText(
  result: { content?: Array<{ type?: string; text?: string }> } | null | undefined
) {
  return (
    result?.content
      ?.filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text?.trim())
      .filter(Boolean)
      .join('\n') ?? ''
  );
}

function normalizeDraft(payload: DraftPayload | null | undefined): TicketDraft | null {
  if (!payload?.draft) return null;

  return {
    title: payload.draft.title?.trim() ?? '',
    description: payload.draft.description?.trim() ?? '',
    priority: payload.draft.priority ?? 'medium',
    projectId: payload.draft.projectId ?? null,
    projectName: payload.draft.projectName ?? null,
    sourceSummary: payload.draft.sourceSummary?.trim() ?? ''
  };
}

function getPriorityClasses(priority: Priority) {
  switch (priority) {
    case 'low':
      return 'bg-slate-500/12 text-slate-700';
    case 'high':
      return 'bg-orange-500/12 text-orange-700';
    case 'urgent':
      return 'bg-red-500/12 text-red-700';
    default:
      return 'bg-blue-500/12 text-blue-700';
  }
}

export function TicketCardResource() {
  const { input, output, isLoading, isCancelled, cancelReason } = useToolData<
    CreateTicketDraftInput,
    DraftPayload
  >();
  const callServerTool = useCallServerTool();
  const updateModelContext = useUpdateModelContext();
  const displayMode = useDisplayMode();
  const platform = usePlatform();
  const locale = useLocale();

  const [draft, setDraft] = useState<TicketDraft>(EMPTY_DRAFT);
  const [saveToolName, setSaveToolName] = useState('save_ticket_draft');
  const [statusText, setStatusText] = useState('Waiting for draft data...');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedTicket, setSavedTicket] = useState<DraftPayload['ticket'] | null>(null);

  useEffect(() => {
    const nextDraft = normalizeDraft(output);
    if (nextDraft) {
      setDraft(nextDraft);
      setStatusText('Review the draft, make any edits you want, then save it to Overlord.');
      setErrorText(null);
    } else if (input && !output) {
      setDraft(current => ({
        ...current,
        title: input.title?.trim() ?? current.title,
        description: input.description?.trim() ?? input.conversationContext.trim(),
        priority: input.priority ?? current.priority,
        projectId: input.projectId ?? current.projectId,
        sourceSummary: summarizeConversation(input.conversationContext)
      }));
    }

    if (output?.ticketCard?.saveToolName) {
      setSaveToolName(output.ticketCard.saveToolName);
    }

    if (output?.ticket) {
      setSavedTicket(output.ticket);
      setStatusText(`Saved as ticket ${output.ticket.reference}.`);
    }
  }, [input, output]);

  async function handleSave() {
    if (!draft.description.trim() || isSaving || savedTicket) return;

    setIsSaving(true);
    setErrorText(null);
    setStatusText('Saving ticket draft...');

    try {
      const result = await callServerTool({
        name: saveToolName,
        arguments: {
          title: draft.title,
          description: draft.description,
          priority: draft.priority,
          projectId: draft.projectId ?? undefined
        }
      });
      const typedResult = result as {
        content?: Array<{ type?: string; text?: string }>;
        isError?: boolean;
        structuredContent?: DraftPayload;
      };

      if (typedResult.isError) {
        setErrorText(extractText(typedResult) || 'The server rejected the save request.');
        setStatusText('Fix the draft and try again.');
        return;
      }

      const ticket = typedResult.structuredContent?.ticket ?? null;
      if (!ticket) {
        setErrorText('The server saved the ticket but did not return ticket details.');
        setStatusText('Save may have succeeded. Check Overlord.');
        return;
      }

      setSavedTicket(ticket);
      setStatusText(`Saved as ticket ${ticket.reference}.`);

      await updateModelContext({
        content: [
          { type: 'text', text: `Created Overlord ticket ${ticket.reference}: ${ticket.title}` }
        ],
        structuredContent: { savedTicket: ticket }
      }).catch(() => undefined);
    } catch (saveError) {
      setErrorText(saveError instanceof Error ? saveError.message : 'Failed to save ticket draft.');
      setStatusText('Save failed. You can edit the draft and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  const currentPriority =
    PRIORITY_OPTIONS.find(option => option.value === draft.priority) ?? PRIORITY_OPTIONS[1];
  const canSave = Boolean(draft.description.trim()) && !isSaving && !savedTicket;

  if (isCancelled) {
    return (
      <SafeArea className="min-h-screen bg-[var(--color-background-primary)] text-[var(--color-text-primary)]">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <div className="rounded-3xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
              Ticket Draft Cancelled
            </p>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              {cancelReason?.trim() || 'The host cancelled this draft before it was rendered.'}
            </p>
          </div>
        </div>
      </SafeArea>
    );
  }

  return (
    <SafeArea className="min-h-screen bg-[var(--color-background-primary)] text-[var(--color-text-primary)]">
      <main className="mx-auto max-w-4xl px-3 py-3 sm:px-4 sm:py-4">
        <section className="overflow-hidden rounded-[28px] border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] shadow-[0_18px_60px_rgba(15,23,42,0.14)]">
          <div className="h-1 w-full bg-[linear-gradient(90deg,#f59e0b,#10b981)]" />

          <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
                Overlord Ticket Draft
              </p>
              <h1 className="text-[clamp(1.4rem,3vw,1.9rem)] font-semibold leading-tight">
                Turn this into a trackable ticket
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
                This Sunpeak resource mirrors the existing ticket-card workflow while keeping the
                production MCP contract unchanged.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] ${getPriorityClasses(currentPriority.value)}`}
              >
                {currentPriority.label}
              </span>
            </div>
          </div>

          <div
            className={`grid gap-4 px-5 pb-5 ${displayMode === 'fullscreen' ? 'lg:grid-cols-[2fr_1fr]' : 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'}`}
          >
            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                  Title
                </span>
                <input
                  autoFocus
                  className="w-full rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-4 py-3 text-sm outline-none transition focus:border-emerald-500"
                  disabled={Boolean(savedTicket)}
                  maxLength={120}
                  value={draft.title}
                  onChange={event =>
                    setDraft(current => ({ ...current, title: event.target.value }))
                  }
                />
              </label>

              <label className="block space-y-2">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                  Priority
                </span>
                <select
                  className="w-full rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-4 py-3 text-sm outline-none transition focus:border-emerald-500"
                  disabled={Boolean(savedTicket)}
                  value={draft.priority}
                  onChange={event =>
                    setDraft(current => ({
                      ...current,
                      priority: event.target.value as Priority
                    }))
                  }
                >
                  {PRIORITY_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-[var(--color-text-secondary)]">{currentPriority.hint}</p>
              </label>

              <label className="block space-y-2">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                  Description
                </span>
                <textarea
                  className="min-h-56 w-full rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-4 py-3 text-sm outline-none transition focus:border-emerald-500"
                  disabled={Boolean(savedTicket)}
                  rows={10}
                  value={draft.description}
                  onChange={event =>
                    setDraft(current => ({ ...current, description: event.target.value }))
                  }
                />
              </label>
            </div>

            <aside className="space-y-4 rounded-[24px] border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                  Destination project
                </p>
                <p className="mt-2 text-sm leading-6">{draft.projectName || 'Default project'}</p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                  Context summary
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                  {draft.sourceSummary ||
                    summarizeConversation(input?.conversationContext) ||
                    'Waiting for the server to prepare a summary.'}
                </p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                  Host
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                  {platform || 'web'} / {displayMode} / {locale}
                </p>
              </div>

              {savedTicket ? (
                <div className="rounded-2xl bg-emerald-500/10 p-4 text-sm text-emerald-700">
                  Saved as {savedTicket.reference}. The host model context was updated with the new
                  ticket metadata.
                </div>
              ) : null}

              {errorText ? (
                <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-700">
                  {errorText}
                </div>
              ) : null}
            </aside>
          </div>

          <div className="flex flex-col gap-4 border-t border-[var(--color-border-tertiary)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
              {isLoading && !output ? 'Waiting for draft data...' : statusText}
            </p>

            <button
              className="min-h-12 rounded-full bg-[linear-gradient(135deg,#111827,#065f46)] px-5 text-sm font-bold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSave}
              type="button"
              onClick={handleSave}
            >
              {savedTicket
                ? `Saved as ${savedTicket.reference}`
                : isSaving
                  ? 'Saving...'
                  : 'Save ticket'}
            </button>
          </div>
        </section>
      </main>
    </SafeArea>
  );
}
