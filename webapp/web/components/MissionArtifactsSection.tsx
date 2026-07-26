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
  TestTube2
} from 'lucide-react';
import { type FormEvent, useState } from 'react';

import type { ArtifactDto, ArtifactType } from '../../shared/contract.ts';
import { useMissionArtifacts, useUpdateMissionArtifact } from '../lib/queries.ts';

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

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function ArtifactCard({ artifact, missionId }: { artifact: ArtifactDto; missionId: string }) {
  const { icon: Icon, label: typeLabel } = artifactMeta(artifact.type);
  const updateArtifact = useUpdateMissionArtifact(missionId);
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(artifact.label);
  const [contentText, setContentText] = useState(artifact.contentText ?? '');
  const [externalUrl, setExternalUrl] = useState(artifact.externalUrl ?? '');

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
            <span>{formatDate(artifact.createdAt)}</span>
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
              <div className="flex justify-end">
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
    </article>
  );
}

export function MissionArtifactsSection({ missionId }: { missionId: string }) {
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

  const artifacts = artifactsQ.data ?? [];
  if (artifacts.length === 0) {
    return <p className="text-sm italic text-(--color-ink-dim)">No artifacts yet.</p>;
  }

  return (
    <div className="grid gap-3">
      {artifacts.map(artifact => (
        <ArtifactCard key={artifact.id} artifact={artifact} missionId={missionId} />
      ))}
    </div>
  );
}
