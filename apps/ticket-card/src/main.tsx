import { useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react';
import { startTransition, useEffect, useEffectEvent, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Priority = 'low' | 'medium' | 'high' | 'urgent';

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

function normalizeDraft(payload: DraftPayload): TicketDraft | null {
  if (!payload.draft) return null;

  return {
    title: payload.draft.title?.trim() ?? '',
    description: payload.draft.description?.trim() ?? '',
    priority: payload.draft.priority ?? 'medium',
    projectId: payload.draft.projectId ?? null,
    projectName: payload.draft.projectName ?? null,
    sourceSummary: payload.draft.sourceSummary?.trim() ?? ''
  };
}

function AppRoot() {
  const [draft, setDraft] = useState<TicketDraft>(EMPTY_DRAFT);
  const [saveToolName, setSaveToolName] = useState('save_ticket_draft');
  const [statusText, setStatusText] = useState('Waiting for draft data…');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedTicket, setSavedTicket] = useState<DraftPayload['ticket'] | null>(null);

  const { app, error } = useApp({
    appInfo: {
      name: 'overlord-ticket-card',
      version: '1.0.0'
    },
    capabilities: {}
  });

  useHostStyles(app ?? null, app?.getHostContext());

  const applyPayload = useEffectEvent((payload: DraftPayload | null | undefined) => {
    if (!payload) return;

    const nextDraft = normalizeDraft(payload);
    startTransition(() => {
      if (nextDraft) {
        setDraft(nextDraft);
        setErrorText(null);
        setStatusText('Review the draft, make any edits you want, then save it to Overlord.');
      }

      if (payload.ticketCard?.saveToolName) {
        setSaveToolName(payload.ticketCard.saveToolName);
      }

      if (payload.ticket) {
        setSavedTicket(payload.ticket);
        setStatusText(`Saved as ticket ${payload.ticket.reference}.`);
      }
    });
  });

  useEffect(() => {
    if (!app) return;

    app.ontoolresult = ({ result }) => {
      const typedResult = result as { structuredContent?: DraftPayload } | undefined;
      applyPayload(typedResult?.structuredContent);
    };

    app.ontoolcancelled = ({ reason }) => {
      setStatusText(reason?.trim() || 'The host cancelled this draft.');
    };
  }, [app]);

  async function postSaveConfirmation(ticket: NonNullable<DraftPayload['ticket']>) {
    if (!app) return;

    const messageText = `Created Overlord ticket ${ticket.reference}: ${ticket.title}`;

    if (app.getHostCapabilities()?.message?.text) {
      await app.sendMessage({
        role: 'user',
        content: [{ type: 'text', text: messageText }]
      });
      return;
    }

    if (app.getHostCapabilities()?.updateModelContext?.structuredContent) {
      await app.updateModelContext({
        content: [{ type: 'text', text: messageText }],
        structuredContent: { savedTicket: ticket }
      });
    }
  }

  async function handleSave() {
    if (!app || !draft.description.trim() || isSaving || savedTicket) return;

    setIsSaving(true);
    setErrorText(null);
    setStatusText('Saving ticket draft…');

    try {
      const result = await app.callServerTool({
        name: saveToolName,
        arguments: {
          title: draft.title,
          description: draft.description,
          priority: draft.priority,
          projectId: draft.projectId ?? undefined
        }
      });
      const typedResult = result as DraftPayload & {
        content?: Array<{ type?: string; text?: string }>;
        isError?: boolean;
        structuredContent?: DraftPayload;
      };

      if (typedResult.isError) {
        setErrorText(extractText(typedResult) || 'The server rejected the save request.');
        setStatusText('Fix the draft and try again.');
        return;
      }

      const payload = typedResult.structuredContent;
      const ticket = payload?.ticket ?? null;
      if (!ticket) {
        setErrorText('The server saved the ticket but did not return ticket details.');
        setStatusText('Save may have succeeded. Check Overlord.');
        return;
      }

      setSavedTicket(ticket);
      setStatusText(`Saved as ticket ${ticket.reference}.`);
      await postSaveConfirmation(ticket);
    } catch (saveError) {
      const nextError =
        saveError instanceof Error ? saveError.message : 'Failed to save ticket draft.';
      setErrorText(nextError);
      setStatusText('Save failed. You can edit the draft and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  const hostPlatform = app?.getHostContext()?.platform ?? 'web';
  const canSave = Boolean(draft.description.trim()) && !isSaving && !savedTicket;
  const currentPriority =
    PRIORITY_OPTIONS.find(option => option.value === draft.priority) ?? PRIORITY_OPTIONS[1];

  return (
    <main className={`ticket-card-shell platform-${hostPlatform}`}>
      <section className="ticket-card-panel">
        <div className="ticket-card-header">
          <div>
            <p className="ticket-card-eyebrow">Overlord Ticket Draft</p>
            <h1>Turn this into a trackable ticket</h1>
          </div>
          <span className={`ticket-card-priority ticket-card-priority-${currentPriority.value}`}>
            {currentPriority.label}
          </span>
        </div>

        <p className="ticket-card-intro">
          The conversation has been converted into an editable draft. Review it here, then save
          directly to Overlord without leaving chat.
        </p>

        <div className="ticket-card-grid">
          <label className="ticket-card-field">
            <span>Title</span>
            <input
              autoFocus
              className="ticket-card-input"
              disabled={Boolean(savedTicket)}
              maxLength={120}
              value={draft.title}
              onChange={event => setDraft(current => ({ ...current, title: event.target.value }))}
            />
          </label>

          <label className="ticket-card-field">
            <span>Priority</span>
            <select
              className="ticket-card-select"
              disabled={Boolean(savedTicket)}
              value={draft.priority}
              onChange={event =>
                setDraft(current => ({ ...current, priority: event.target.value as Priority }))
              }
            >
              {PRIORITY_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>{currentPriority.hint}</small>
          </label>

          <label className="ticket-card-field ticket-card-field-full">
            <span>Description</span>
            <textarea
              className="ticket-card-textarea"
              disabled={Boolean(savedTicket)}
              rows={9}
              value={draft.description}
              onChange={event =>
                setDraft(current => ({ ...current, description: event.target.value }))
              }
            />
          </label>
        </div>

        <aside className="ticket-card-aside">
          <div>
            <p className="ticket-card-meta-label">Destination project</p>
            <p className="ticket-card-meta-value">{draft.projectName || 'Default project'}</p>
          </div>
          <div>
            <p className="ticket-card-meta-label">Context summary</p>
            <p className="ticket-card-meta-value ticket-card-summary">
              {draft.sourceSummary || 'Waiting for the server to prepare a summary.'}
            </p>
          </div>
        </aside>

        <div className="ticket-card-footer">
          <div className="ticket-card-status" aria-live="polite">
            {error ? `App bridge error: ${error.message}` : errorText || statusText}
          </div>

          <button
            className="ticket-card-button"
            disabled={!canSave}
            type="button"
            onClick={handleSave}
          >
            {savedTicket
              ? `Saved as ${savedTicket.reference}`
              : isSaving
                ? 'Saving…'
                : 'Save ticket'}
          </button>
        </div>
      </section>
    </main>
  );
}

const container = document.getElementById('root');

if (container) {
  createRoot(container).render(<AppRoot />);
}
