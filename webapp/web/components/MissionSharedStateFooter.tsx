import { ChevronDown, ChevronRight, PenLine, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import type { SharedContextEntryDto } from '../../shared/contract.ts';
import { useMissionSharedContext, useUpsertMissionSharedContext } from '../lib/queries.ts';

import { Button, Spinner, TextArea, TextInput } from './ui.tsx';

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseEditedValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function SharedContextEntryRow({
  entry,
  missionId
}: {
  entry: SharedContextEntryDto;
  missionId: string;
}) {
  const upsert = useUpsertMissionSharedContext(missionId);
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [valueText, setValueText] = useState(formatValue(entry.value));

  function beginEditing() {
    setValueText(formatValue(entry.value));
    setIsEditing(true);
    setExpanded(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    upsert.reset();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await upsert.mutateAsync({
      key: entry.key,
      value: parseEditedValue(valueText)
    });
    setIsEditing(false);
  }

  return (
    <article className="min-w-0 rounded-md border border-(--color-border) bg-(--color-surface-1)">
      <button
        type="button"
        className={`flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-(--color-surface-2) ${
          expanded ? 'bg-(--color-surface-2)' : ''
        }`}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-(--color-ink-dim)" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-(--color-ink-dim)" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-(--color-ink)">
          {entry.key}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-(--color-ink-dim)">
          {entry.valueKind}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-(--color-border) px-2.5 pb-2.5 pt-2">
          {isEditing ? (
            <form className="grid gap-2" onSubmit={save}>
              <label className="grid gap-1 text-[11px] font-medium text-(--color-ink-dim)">
                Value
                <TextArea
                  value={valueText}
                  onChange={event => setValueText(event.target.value)}
                  rows={4}
                  className="font-mono text-xs"
                />
              </label>
              {upsert.isError && (
                <p className="text-xs text-red-400">{(upsert.error as Error).message}</p>
              )}
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={upsert.isPending} className="h-7 px-2 text-xs">
                  {upsert.isPending ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={cancelEditing}
                  disabled={upsert.isPending}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-(--color-ink-dim)">
                  Updated {formatDate(entry.updatedAt)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={beginEditing}
                >
                  <PenLine className="mr-1 h-3 w-3" />
                  Edit
                </Button>
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-(--color-surface-2) p-2 font-mono text-[11px] text-(--color-ink)">
                {formatValue(entry.value) || (
                  <span className="italic text-(--color-ink-dim)">Empty</span>
                )}
              </pre>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function AddSharedContextForm({ missionId }: { missionId: string }) {
  const upsert = useUpsertMissionSharedContext(missionId);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [valueText, setValueText] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await upsert.mutateAsync({
      key,
      value: parseEditedValue(valueText)
    });
    setKey('');
    setValueText('');
    setOpen(false);
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-7 justify-start px-2 text-xs text-(--color-ink-dim)"
        onClick={() => setOpen(true)}
      >
        <Plus className="mr-1 h-3 w-3" />
        Add entry
      </Button>
    );
  }

  return (
    <form
      className="grid gap-2 rounded-md border border-dashed border-(--color-border) p-2.5"
      onSubmit={save}
    >
      <label className="grid gap-1 text-[11px] font-medium text-(--color-ink-dim)">
        Key
        <TextInput
          value={key}
          onChange={event => setKey(event.target.value)}
          placeholder="repo.testing"
          required
          className="font-mono text-xs"
        />
      </label>
      <label className="grid gap-1 text-[11px] font-medium text-(--color-ink-dim)">
        Value
        <TextArea
          value={valueText}
          onChange={event => setValueText(event.target.value)}
          rows={3}
          placeholder="String or JSON"
          className="font-mono text-xs"
        />
      </label>
      {upsert.isError && <p className="text-xs text-red-400">{(upsert.error as Error).message}</p>}
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          disabled={upsert.isPending || !key.trim()}
          className="h-7 px-2 text-xs"
        >
          {upsert.isPending ? 'Saving…' : 'Add'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => {
            setOpen(false);
            upsert.reset();
          }}
          disabled={upsert.isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Collapsed-by-default footer for mission shared state (`shared_context_entries`).
 * Desktop embeds the same SPA, so this covers both web and desktop mission views.
 */
export function MissionSharedStateFooter({ missionId }: { missionId: string }) {
  const contextQ = useMissionSharedContext(missionId);
  const [open, setOpen] = useState(false);
  const entries = contextQ.data ?? [];
  const countLabel = contextQ.isLoading ? '…' : String(entries.length);

  return (
    <footer className="shrink-0 border-t border-(--color-border) bg-(--color-surface-1)">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-5 py-2 text-left transition-colors hover:bg-(--color-surface-2)"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-(--color-ink-dim)" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-(--color-ink-dim)" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
          Shared State
        </span>
        <span className="rounded-full bg-(--color-surface-2) px-1.5 py-0.5 text-[10px] tabular-nums text-(--color-ink-dim)">
          {countLabel}
        </span>
      </button>

      {open && (
        <div className="max-h-64 space-y-2 overflow-y-auto border-t border-(--color-border) px-5 py-3">
          <p className="text-[11px] text-(--color-ink-dim)">
            Durable facts agents inherit across objectives. Avoid pasting secrets.
          </p>
          {contextQ.isLoading ? (
            <div className="flex justify-center py-3">
              <Spinner />
            </div>
          ) : contextQ.isError ? (
            <p className="text-sm text-red-400">
              Could not load shared state: {(contextQ.error as Error)?.message ?? 'unknown error'}
            </p>
          ) : (
            <>
              {entries.length === 0 ? (
                <p className="text-sm italic text-(--color-ink-dim)">No shared state yet.</p>
              ) : (
                <div className="grid gap-2">
                  {entries.map(entry => (
                    <SharedContextEntryRow key={entry.id} entry={entry} missionId={missionId} />
                  ))}
                </div>
              )}
              <AddSharedContextForm missionId={missionId} />
            </>
          )}
        </div>
      )}
    </footer>
  );
}
