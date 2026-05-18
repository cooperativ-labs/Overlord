'use client';

import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Textarea } from '@/components/ui/textarea';
import {
  archiveChangelogEntryAction,
  type ChangelogEntry,
  generateChangelogDraftAction,
  publishChangelogEntryAction,
  updateChangelogDraftAction
} from '@/lib/actions/changelog';
import { cn } from '@/lib/utils';

type Props = {
  initialEntries: ChangelogEntry[];
};

type EditableFields = {
  title: string;
  slug: string;
  summary: string;
  version: string;
  body_markdown: string;
};

function toEditable(entry: ChangelogEntry): EditableFields {
  return {
    title: entry.title,
    slug: entry.slug,
    summary: entry.summary ?? '',
    version: entry.version ?? '',
    body_markdown: entry.body_markdown
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

const STATUS_STYLES: Record<ChangelogEntry['status'], string> = {
  draft: 'bg-amber-500/15 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  published: 'bg-emerald-500/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  archived: 'bg-muted text-muted-foreground'
};

export function ChangelogPanel({ initialEntries }: Props) {
  const [entries, setEntries] = useState<ChangelogEntry[]>(initialEntries);
  const [selectedId, setSelectedId] = useState<string | null>(initialEntries[0]?.id ?? null);
  const [editable, setEditable] = useState<EditableFields | null>(
    initialEntries[0] ? toEditable(initialEntries[0]) : null
  );
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [generateState, setGenerateState] = useState<ButtonLoadingState>('default');
  const [saveState, setSaveState] = useState<ButtonLoadingState>('default');
  const [publishState, setPublishState] = useState<ButtonLoadingState>('default');
  const [archiveState, setArchiveState] = useState<ButtonLoadingState>('default');
  const [error, setError] = useState<string | null>(null);

  const selectedEntry = useMemo(
    () => entries.find(entry => entry.id === selectedId) ?? null,
    [entries, selectedId]
  );

  function selectEntry(entry: ChangelogEntry) {
    setSelectedId(entry.id);
    setEditable(toEditable(entry));
    setActiveTab('edit');
    setError(null);
  }

  function patchEntries(updated: ChangelogEntry) {
    setEntries(current => {
      const exists = current.some(entry => entry.id === updated.id);
      const next = exists
        ? current.map(entry => (entry.id === updated.id ? updated : entry))
        : [updated, ...current];
      return [...next].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    });
  }

  async function handleGenerate() {
    setError(null);
    setGenerateState('loading');
    try {
      const result = await generateChangelogDraftAction();
      // Reload from list so we get the full row.
      const { listChangelogEntriesAction } = await import('@/lib/actions/changelog');
      const fresh = await listChangelogEntriesAction();
      setEntries(fresh);
      const created = fresh.find(entry => entry.id === result.id);
      if (created) selectEntry(created);
      setGenerateState(result.empty ? 'success' : 'success');
    } catch (err) {
      setGenerateState('error');
      setError(err instanceof Error ? err.message : 'Failed to generate draft.');
    }
  }

  async function handleSave() {
    if (!selectedEntry || !editable) return;
    setError(null);
    setSaveState('loading');
    try {
      const updated = await updateChangelogDraftAction(selectedEntry.id, {
        title: editable.title,
        slug: editable.slug,
        summary: editable.summary || null,
        version: editable.version || null,
        body_markdown: editable.body_markdown
      });
      patchEntries(updated);
      setSaveState('success');
    } catch (err) {
      setSaveState('error');
      setError(err instanceof Error ? err.message : 'Failed to save draft.');
    }
  }

  async function handlePublish() {
    if (!selectedEntry) return;
    setError(null);
    setPublishState('loading');
    try {
      // Save edits first so they're included in the publish.
      if (editable) {
        const updated = await updateChangelogDraftAction(selectedEntry.id, {
          title: editable.title,
          slug: editable.slug,
          summary: editable.summary || null,
          version: editable.version || null,
          body_markdown: editable.body_markdown
        });
        patchEntries(updated);
      }
      const published = await publishChangelogEntryAction(selectedEntry.id);
      patchEntries(published);
      setEditable(toEditable(published));
      setPublishState('success');
    } catch (err) {
      setPublishState('error');
      setError(err instanceof Error ? err.message : 'Failed to publish entry.');
    }
  }

  async function handleArchive() {
    if (!selectedEntry) return;
    setError(null);
    setArchiveState('loading');
    try {
      const archived = await archiveChangelogEntryAction(selectedEntry.id);
      patchEntries(archived);
      setEditable(toEditable(archived));
      setArchiveState('success');
    } catch (err) {
      setArchiveState('error');
      setError(err instanceof Error ? err.message : 'Failed to archive entry.');
    }
  }

  return (
    <section className="rounded-[2rem] border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Changelog</h2>
          <p className="text-sm text-muted-foreground">
            Curate user-facing release notes shown on the public site and in-app.
          </p>
        </div>
        <LoadingButton
          buttonState={generateState}
          setButtonState={setGenerateState}
          text="Generate Changelog Entry"
          loadingText="Drafting..."
          successText="Draft ready"
          errorText="Generate failed"
          reset
          onClick={handleGenerate}
        />
      </div>

      <div className="flex flex-col gap-6 p-6 lg:flex-row">
        <aside className="w-full shrink-0 lg:w-80">
          <div className="overflow-hidden rounded-2xl border border-border">
            {entries.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No entries yet. Click{' '}
                <span className="font-medium text-foreground">Generate Changelog Entry</span> to
                create your first draft.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {entries.map(entry => {
                  const isSelected = entry.id === selectedId;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => selectEntry(entry)}
                        className={cn(
                          'flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition',
                          isSelected
                            ? 'bg-sky-500/15 dark:bg-sky-500/10'
                            : 'bg-card hover:bg-muted/60'
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {entry.title || '(untitled)'}
                          </span>
                          <span
                            className={cn(
                              'inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              STATUS_STYLES[entry.status]
                            )}
                          >
                            {entry.status}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {entry.published_at
                            ? `Published ${formatDateTime(entry.published_at)}`
                            : `Updated ${formatDateTime(entry.updated_at)}`}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {error ? (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          ) : null}

          {!selectedEntry || !editable ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-16 text-center text-sm text-muted-foreground">
              Select or generate an entry to start editing.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="changelog-title">Title</Label>
                  <Input
                    id="changelog-title"
                    value={editable.title}
                    onChange={e => setEditable({ ...editable, title: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="changelog-slug">Slug</Label>
                  <Input
                    id="changelog-slug"
                    value={editable.slug}
                    onChange={e => setEditable({ ...editable, slug: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="changelog-version">Version (optional)</Label>
                  <Input
                    id="changelog-version"
                    placeholder="e.g. 0.2606010800.0"
                    value={editable.version}
                    onChange={e => setEditable({ ...editable, version: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="changelog-summary">Summary</Label>
                  <Input
                    id="changelog-summary"
                    placeholder="1–2 sentence teaser for modal & email"
                    value={editable.summary}
                    onChange={e => setEditable({ ...editable, summary: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 border-b border-border">
                {(['edit', 'preview'] as const).map(tab => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      '-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition',
                      activeTab === tab
                        ? 'border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {activeTab === 'edit' ? (
                <Textarea
                  rows={22}
                  className="font-mono text-sm"
                  value={editable.body_markdown}
                  onChange={e => setEditable({ ...editable, body_markdown: e.target.value })}
                />
              ) : (
                <div className="min-h-[24rem] rounded-2xl border border-border bg-card p-6">
                  <MarkdownContent>{editable.body_markdown || '_(empty)_'}</MarkdownContent>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <LoadingButton
                  buttonState={saveState}
                  setButtonState={setSaveState}
                  text="Save draft"
                  loadingText="Saving..."
                  successText="Saved"
                  errorText="Save failed"
                  reset
                  onClick={handleSave}
                />
                <LoadingButton
                  buttonState={publishState}
                  setButtonState={setPublishState}
                  text={selectedEntry.status === 'published' ? 'Re-publish' : 'Publish'}
                  loadingText="Publishing..."
                  successText="Published"
                  errorText="Publish failed"
                  reset
                  onClick={handlePublish}
                />
                {selectedEntry.status !== 'archived' ? (
                  <LoadingButton
                    buttonState={archiveState}
                    setButtonState={setArchiveState}
                    text="Archive"
                    loadingText="Archiving..."
                    successText="Archived"
                    errorText="Archive failed"
                    reset
                    onClick={handleArchive}
                  />
                ) : null}
                {selectedEntry.status === 'published' && selectedEntry.slug ? (
                  <a
                    href={`/changelog/${selectedEntry.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                  >
                    View live →
                  </a>
                ) : null}
                {generateState === 'loading' ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
