import type { ArtifactDto, ArtifactType, ObjectiveDto } from '@overlord/contract';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode2,
  FileText,
  Link,
  type LucideIcon,
  MessageSquare,
  PenLine,
  Plus,
  TestTube2,
  Trash2
} from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { Button as IconButton } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

import { formatTimestamp } from '../lib/format-date.ts';
import {
  useCreateMissionArtifact,
  useDeleteMissionArtifact,
  useMissionArtifacts,
  useUpdateMissionArtifact
} from '../lib/queries.ts';

import { Markdown } from './Markdown.tsx';
import { Badge, Button, Spinner, TextArea, TextInput } from './ui.tsx';

const ARTIFACT_META: Record<ArtifactType, { icon: LucideIcon; label: string }> = {
  test_results: { icon: TestTube2, label: 'Test Results' },
  next_steps: { icon: CheckCircle2, label: 'Next Steps' },
  note: { icon: MessageSquare, label: 'Note' },
  url: { icon: Link, label: 'URL' },
  decision: { icon: FileText, label: 'Decision' },
  migration: { icon: FileCode2, label: 'Migration' }
};

function artifactMeta(type: string): { icon: LucideIcon | null; label: string } {
  return ARTIFACT_META[type as ArtifactType] ?? { icon: null, label: type.replace(/_/g, ' ') };
}

/** Types offered when a person adds an artifact by hand; notes are the common case. */
const CREATABLE_TYPES: readonly ArtifactType[] = [
  'note',
  'decision',
  'next_steps',
  'test_results',
  'url',
  'migration'
];

function errorMessage(error: unknown, fallback: string): string {
  return (error as Error | null)?.message || fallback;
}

function DeleteArtifactDialog({
  artifact,
  missionId,
  open,
  onOpenChange
}: {
  artifact: ArtifactDto;
  missionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const deleteArtifact = useDeleteMissionArtifact(missionId);

  function changeOpen(next: boolean) {
    if (deleteArtifact.isPending) return;
    if (!next) deleteArtifact.reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete this artifact?</DialogTitle>
          <DialogDescription>
            “{artifact.label}” will be removed from this mission and from agent context.
          </DialogDescription>
        </DialogHeader>
        {deleteArtifact.isError && (
          <p className="text-xs text-red-400">
            {errorMessage(deleteArtifact.error, 'Could not delete artifact.')}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => changeOpen(false)}
            disabled={deleteArtifact.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={deleteArtifact.isPending}
            onClick={() =>
              deleteArtifact.mutate(artifact.id, { onSuccess: () => onOpenChange(false) })
            }
          >
            {deleteArtifact.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewArtifactForm({ missionId, onDone }: { missionId: string; onDone: () => void }) {
  const createArtifact = useCreateMissionArtifact(missionId);
  const [type, setType] = useState<ArtifactType>('note');
  const [label, setLabel] = useState('');
  const [contentText, setContentText] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const hasContent = Boolean(contentText.trim() || externalUrl.trim());
  const canSave = Boolean(label.trim()) && hasContent && !createArtifact.isPending;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    await createArtifact.mutateAsync({
      type,
      label: label.trim(),
      contentText: contentText.trim() ? contentText : null,
      externalUrl: externalUrl.trim() || null
    });
    onDone();
  }

  return (
    <form
      className="grid gap-3 rounded-lg border border-(--color-border) bg-(--color-surface-1) p-3"
      onSubmit={save}
      aria-label="New artifact"
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="grid gap-1 text-xs font-medium text-(--color-ink-dim)">
          Type
          <Select value={type} onValueChange={next => next && setType(next as ArtifactType)}>
            <SelectTrigger aria-label="Artifact type" className="w-full">
              <SelectValue>{artifactMeta(type).label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CREATABLE_TYPES.map(option => (
                <SelectItem key={option} value={option}>
                  {artifactMeta(option).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-(--color-ink-dim)">
          Label
          <TextInput
            value={label}
            onChange={event => setLabel(event.target.value)}
            placeholder="What is this artifact?"
            required
            autoFocus
          />
        </label>
      </div>
      <label className="grid gap-1 text-xs font-medium text-(--color-ink-dim)">
        Markdown
        <TextArea
          value={contentText}
          onChange={event => setContentText(event.target.value)}
          rows={6}
          className="font-mono text-xs"
          placeholder="Write artifact details in Markdown"
        />
      </label>
      <label className="grid gap-1 text-xs font-medium text-(--color-ink-dim)">
        External URL
        <TextInput
          type="url"
          value={externalUrl}
          onChange={event => setExternalUrl(event.target.value)}
          placeholder="https://…"
        />
      </label>
      {createArtifact.isError ? (
        <p className="text-xs text-red-400">
          {errorMessage(createArtifact.error, 'Could not add artifact.')}
        </p>
      ) : !hasContent && label.trim() ? (
        <p className="text-xs text-(--color-ink-dim)">Add Markdown or a URL.</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone} disabled={createArtifact.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!canSave}>
          {createArtifact.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

function ArtifactCard({
  artifact,
  missionId,
  objectiveDisplayId
}: {
  artifact: ArtifactDto;
  missionId: string;
  /** Display id of the objective that produced the artifact, when it still exists. */
  objectiveDisplayId: string | null;
}) {
  const { icon: Icon, label: typeLabel } = artifactMeta(artifact.type);
  const updateArtifact = useUpdateMissionArtifact(missionId);
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(artifact.label);
  const [contentText, setContentText] = useState(artifact.contentText ?? '');
  const [externalUrl, setExternalUrl] = useState(artifact.externalUrl ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function beginEditing() {
    setLabel(artifact.label);
    setContentText(artifact.contentText ?? '');
    setExternalUrl(artifact.externalUrl ?? '');
    setIsEditing(true);
    setExpanded(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    updateArtifact.reset();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await updateArtifact.mutateAsync({
      artifactId: artifact.id,
      body: {
        expectedRevision: artifact.revision,
        label,
        contentText: contentText || null,
        externalUrl: externalUrl || null
      }
    });
    setIsEditing(false);
  }

  return (
    <article className="min-w-0 rounded-lg border border-(--color-border) bg-(--color-surface-1)">
      <button
        type="button"
        className={`flex w-full items-center gap-2.5 p-3 text-left transition-colors hover:bg-(--color-surface-2) ${
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
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-(--color-border) bg-(--color-surface-1)">
          {Icon ? (
            <Icon className="h-3.5 w-3.5 text-(--color-ink-dim)" />
          ) : (
            <div className="h-2 w-2 rounded-full bg-(--color-ink-dim)/40" />
          )}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-medium text-(--color-ink)">{artifact.label}</span>
          <span className="flex flex-wrap items-center gap-2 text-[11px] text-(--color-ink-dim)">
            <Badge className="px-1.5 py-0 text-[10px] uppercase tracking-wide">{typeLabel}</Badge>
            {objectiveDisplayId ? (
              <span className="font-mono" title="Produced by objective">
                {objectiveDisplayId}
              </span>
            ) : null}
            <span>{formatTimestamp(artifact.createdAt)}</span>
          </span>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-(--color-border) px-3 pb-3 pt-2">
          {isEditing ? (
            <form className="grid gap-3" onSubmit={save}>
              <label className="grid gap-1 text-xs font-medium text-(--color-ink-dim)">
                Label
                <TextInput
                  value={label}
                  onChange={event => setLabel(event.target.value)}
                  required
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-(--color-ink-dim)">
                Markdown
                <TextArea
                  value={contentText}
                  onChange={event => setContentText(event.target.value)}
                  rows={8}
                  className="font-mono text-xs"
                  placeholder="Write artifact details in Markdown"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-(--color-ink-dim)">
                External URL
                <TextInput
                  type="url"
                  value={externalUrl}
                  onChange={event => setExternalUrl(event.target.value)}
                  placeholder="https://…"
                />
              </label>
              {updateArtifact.isError && (
                <p className="text-xs text-red-400">
                  {(updateArtifact.error as Error).message || 'Could not save artifact.'}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={cancelEditing}
                  disabled={updateArtifact.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={updateArtifact.isPending}>
                  {updateArtifact.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-3">
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={beginEditing}
                >
                  <PenLine className="mr-1 h-3 w-3" />
                  Edit
                </Button>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7 text-(--color-ink-dim) hover:text-red-500"
                  aria-label="Delete artifact"
                  title="Delete artifact"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="h-3 w-3" />
                </IconButton>
              </div>
              {artifact.contentText ? (
                <Markdown text={artifact.contentText} />
              ) : (
                <p className="text-sm italic text-(--color-ink-dim)">No content yet.</p>
              )}
              {artifact.externalUrl && (
                <a
                  href={artifact.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
                >
                  <ExternalLink className="h-3 w-3" />
                  {artifact.externalUrl}
                </a>
              )}
            </div>
          )}
        </div>
      )}
      <DeleteArtifactDialog
        artifact={artifact}
        missionId={missionId}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
      />
    </article>
  );
}

/**
 * The mission's Artifacts section: its header, with a subtle control to add
 * an artifact by hand, and the artifacts as one flat list, newest first.
 * Artifacts stay at mission level rather than inside objectives (coo:879
 * §4.7) because they are frequently mission-scoped — plans, decisions — and
 * revised across objectives; each card instead carries the display id of the
 * objective that produced it, when there is one.
 */
export function MissionArtifactsSection({
  missionId,
  objectives = []
}: {
  missionId: string;
  objectives?: readonly ObjectiveDto[];
}) {
  const [isCreating, setIsCreating] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
          Artifacts
        </h2>
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 text-(--color-ink-dim) hover:text-(--color-ink)"
          aria-label="Add artifact"
          title="Add artifact"
          aria-expanded={isCreating}
          onClick={() => setIsCreating(current => !current)}
        >
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      {isCreating && <NewArtifactForm missionId={missionId} onDone={() => setIsCreating(false)} />}
      <MissionArtifactList missionId={missionId} objectives={objectives} hideEmpty={isCreating} />
    </div>
  );
}

function MissionArtifactList({
  missionId,
  objectives,
  hideEmpty
}: {
  missionId: string;
  objectives: readonly ObjectiveDto[];
  /** The empty notice is redundant while the new-artifact form is open. */
  hideEmpty: boolean;
}) {
  const artifactsQ = useMissionArtifacts(missionId);

  if (artifactsQ.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    );
  }

  if (artifactsQ.isError) {
    return (
      <p className="text-sm text-red-400">
        Could not load artifacts: {(artifactsQ.error as Error)?.message ?? 'unknown error'}
      </p>
    );
  }

  const artifacts = [...(artifactsQ.data ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  if (artifacts.length === 0) {
    return hideEmpty ? null : (
      <p className="text-sm italic text-(--color-ink-dim)">No artifacts yet.</p>
    );
  }
  const displayIdByObjectiveId = new Map(
    objectives.map(objective => [objective.id, objective.displayId])
  );

  return (
    <div className="grid gap-3">
      {artifacts.map(artifact => (
        <ArtifactCard
          key={artifact.id}
          artifact={artifact}
          missionId={missionId}
          objectiveDisplayId={
            artifact.objectiveId ? (displayIdByObjectiveId.get(artifact.objectiveId) ?? null) : null
          }
        />
      ))}
    </div>
  );
}
