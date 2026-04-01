'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Textarea } from '@/components/ui/textarea';
import {
  createTimeRecordForTicket,
  deleteTimeRecord,
  type EverhourTimeRecord,
  listTimeRecordsForTicket,
  updateTimeRecord
} from '@/lib/actions/everhour';

type TimeEntriesPanelProps = {
  ticketId?: string | null;
  everhourTaskId?: string | null;
};

function formatTotal(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatForEdit(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function parseDurationInput(input: string): number | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }

  const hourMatch = normalized.match(/(\d+(?:\.\d+)?)\s*h/);
  const minuteMatch = normalized.match(/(\d+)\s*m/);

  const hours = hourMatch ? Number.parseFloat(hourMatch[1]) : 0;
  const minutes = minuteMatch ? Number.parseInt(minuteMatch[1], 10) : 0;
  const totalSeconds = Math.round((hours * 60 + minutes) * 60);
  return totalSeconds > 0 ? totalSeconds : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Everhour request failed.';
}

export function TimeEntriesPanel({ ticketId, everhourTaskId }: TimeEntriesPanelProps) {
  const [entries, setEntries] = useState<EverhourTimeRecord[]>([]);
  const [isLoadingEntries, setIsLoadingEntries] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState<1 | 7>(1);
  const [addOpen, setAddOpen] = useState(false);
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newDuration, setNewDuration] = useState('');
  const [newComment, setNewComment] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDuration, setEditDuration] = useState('');
  const [editComment, setEditComment] = useState('');
  const [addButtonState, setAddButtonState] = useState<ButtonLoadingState>('default');
  const [editButtonState, setEditButtonState] = useState<ButtonLoadingState>('default');
  const [deleteButtonState, setDeleteButtonState] = useState<ButtonLoadingState>('default');
  const [deletingEntryId, setDeletingEntryId] = useState<number | null>(null);

  const loadEntries = useCallback(async (): Promise<boolean> => {
    setIsLoadingEntries(true);
    try {
      const records = await listTimeRecordsForTicket({
        ticketId,
        daysBack: rangeDays,
        everhourTaskId
      });
      setEntries(records);
      setErrorMessage(null);
      return true;
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      return false;
    } finally {
      setIsLoadingEntries(false);
    }
  }, [ticketId, rangeDays, everhourTaskId]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const totalSeconds = useMemo(() => {
    return entries.reduce((sum, entry) => sum + entry.time, 0);
  }, [entries]);

  if (!ticketId && !everhourTaskId) {
    return null;
  }

  async function handleAdd() {
    const seconds = parseDurationInput(newDuration);
    if (!seconds) {
      setErrorMessage('Enter a valid duration (examples: 1h 30m, 45m, 1800).');
      setAddButtonState('error');
      return;
    }

    setAddButtonState('loading');
    setErrorMessage(null);

    try {
      await createTimeRecordForTicket({
        ticketId,
        everhourTaskId,
        seconds,
        date: newDate,
        comment: newComment
      });
      const didReload = await loadEntries();
      if (!didReload) {
        setAddButtonState('error');
        return;
      }
      setNewDuration('');
      setNewComment('');
      setAddOpen(false);
      setAddButtonState('success');
    } catch (error) {
      setAddButtonState('error');
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleEditSave(recordId: number) {
    const seconds = parseDurationInput(editDuration);
    if (!seconds) {
      setErrorMessage('Enter a valid duration before saving.');
      setEditButtonState('error');
      return;
    }

    setEditButtonState('loading');
    setErrorMessage(null);

    try {
      await updateTimeRecord(recordId, seconds, editComment);
      const didReload = await loadEntries();
      if (!didReload) {
        setEditButtonState('error');
        return;
      }
      setEditingId(null);
      setEditDuration('');
      setEditComment('');
      setEditButtonState('success');
    } catch (error) {
      setEditButtonState('error');
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleDelete(recordId: number) {
    setDeletingEntryId(recordId);
    setDeleteButtonState('loading');
    setErrorMessage(null);

    try {
      await deleteTimeRecord(recordId);
      const didReload = await loadEntries();
      if (!didReload) {
        setDeleteButtonState('error');
        return;
      }
      setDeleteButtonState('success');
    } catch (error) {
      setDeleteButtonState('error');
      setErrorMessage(getErrorMessage(error));
    } finally {
      setDeletingEntryId(null);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Time Entries</h3>
        <div className="text-muted-foreground text-xs">Total: {formatTotal(totalSeconds)}</div>
      </div>

      <div className="space-y-2">
        {isLoadingEntries ? (
          <p className="text-muted-foreground text-xs">Loading entries…</p>
        ) : null}
        {!isLoadingEntries && entries.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No entries found in the past {rangeDays === 1 ? 'day' : 'week'}.
          </p>
        ) : null}

        {entries.map(entry => {
          const isEditing = editingId === entry.id;
          const isDeleting = deletingEntryId === entry.id;

          return (
            <article
              className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm"
              key={entry.id}
            >
              {isEditing ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="w-40"
                      onChange={event => setEditDuration(event.target.value)}
                      placeholder="e.g. 45m"
                      value={editDuration}
                    />
                    <span className="text-muted-foreground self-center text-xs">{entry.date}</span>
                  </div>
                  <Textarea
                    onChange={event => setEditComment(event.target.value)}
                    rows={2}
                    value={editComment}
                  />
                  <div className="flex items-center gap-2">
                    <LoadingButton
                      buttonState={editButtonState}
                      setButtonState={setEditButtonState}
                      text="Save"
                      loadingText="Saving…"
                      successText="Saved"
                      errorText="Retry"
                      reset
                      size="sm"
                      onClick={() => handleEditSave(entry.id)}
                    />
                    <button
                      className="text-muted-foreground text-xs"
                      onClick={() => setEditingId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{formatTotal(entry.time)}</span>
                      <span className="text-muted-foreground text-xs">{entry.date}</span>
                    </div>
                    {entry.comment ? (
                      <p className="text-muted-foreground mt-1 truncate text-xs">{entry.comment}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      className="hover:bg-muted rounded p-1"
                      onClick={() => {
                        setEditingId(entry.id);
                        setEditDuration(formatForEdit(entry.time));
                        setEditComment(entry.comment ?? '');
                        setEditButtonState('default');
                      }}
                      type="button"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <LoadingButton
                      aria-label="Delete time entry"
                      buttonState={isDeleting ? deleteButtonState : 'default'}
                      className="h-6 px-2 text-destructive hover:text-destructive"
                      errorText="Retry"
                      loadingText="…"
                      onClick={() => handleDelete(entry.id)}
                      reset
                      setButtonState={setDeleteButtonState}
                      size="sm"
                      text={<Trash2 className="h-3.5 w-3.5" />}
                      variant="ghost"
                    />
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="flex items-center  gap-2">
        <Button
          onClick={() => {
            setAddOpen(previous => !previous);
            setErrorMessage(null);
          }}
          size="sm"
          variant="outline"
        >
          <Plus className="mr-1 h-4 w-4" />
          {addOpen ? 'Close' : 'Add Entry'}
        </Button>
        <Button
          disabled={isLoadingEntries}
          onClick={() => setRangeDays(previous => (previous === 1 ? 7 : 1))}
          size="sm"
          variant="ghost"
        >
          {rangeDays === 1 ? 'Show Past Week' : 'Show Past Day'}
        </Button>
      </div>
      {addOpen ? (
        <div className="space-y-2 rounded-md border bg-muted/40 p-3">
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-40"
              onChange={event => setNewDate(event.target.value)}
              type="date"
              value={newDate}
            />
            <Input
              className="w-40"
              onChange={event => setNewDuration(event.target.value)}
              placeholder="e.g. 1h 30m"
              value={newDuration}
            />
          </div>
          <Textarea
            onChange={event => setNewComment(event.target.value)}
            placeholder="Optional comment"
            rows={2}
            value={newComment}
          />
          <div className="flex items-center gap-2">
            <LoadingButton
              buttonState={addButtonState}
              setButtonState={setAddButtonState}
              text="Save Entry"
              loadingText="Saving…"
              successText="Saved"
              errorText="Retry"
              reset
              size="sm"
              onClick={handleAdd}
            />
            <button
              className="text-muted-foreground text-xs"
              onClick={() => setAddOpen(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
    </section>
  );
}
