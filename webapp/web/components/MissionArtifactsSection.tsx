import {
  CheckCircle2,
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

function ArtifactEntry({ artifact, missionId }: { artifact: ArtifactDto; missionId: string }) {
  const { icon: Icon, label: typeLabel } = artifactMeta(artifact.type);
  const updateArtifact = useUpdateMissionArtifact(missionId);
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(artifact.label);
  const [contentText, setContentText] = useState(artifact.contentText ?? '');
  const [externalUrl, setExternalUrl] = useState(artifact.externalUrl ?? '');

  function beginEditing() {
    setLabel(artifact.label);
    setContentText(artifact.contentText ?? '');
    setExternalUrl(artifact.externalUrl ?? '');
    setIsEditing(true);
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
    <article className="flex gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {Icon ? (
          <Icon className="h-3.5 w-3.5 text-[var(--color-ink-dim)]" />
        ) : (
          <div className="h-2 w-2 rounded-full bg-[var(--color-ink-dim)]/40" />
        )}
      </div>
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--color-ink)]">{artifact.label}</span>
          <Badge className="px-2 py-0 text-[10px] uppercase tracking-wide">{typeLabel}</Badge>
          <span className="text-[11px] text-[var(--color-ink-dim)]">
            {formatDate(artifact.createdAt)}
          </span>
          {!isEditing && (
            <Button
              type="button"
              variant="ghost"
              className="ml-auto h-6 px-1.5 text-xs"
              onClick={beginEditing}
            >
              <PenLine className="mr-1 h-3 w-3" />
              Edit
            </Button>
          )}
        </div>
        {isEditing ? (
          <form className="grid gap-3" onSubmit={save}>
            <label className="grid gap-1 text-xs font-medium text-[var(--color-ink-dim)]">
              Label
              <TextInput value={label} onChange={event => setLabel(event.target.value)} required />
            </label>
            <label className="grid gap-1 text-xs font-medium text-[var(--color-ink-dim)]">
              Markdown
              <TextArea
                value={contentText}
                onChange={event => setContentText(event.target.value)}
                rows={8}
                className="font-mono text-xs"
                placeholder="Write artifact details in Markdown"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-[var(--color-ink-dim)]">
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
          <>
            {artifact.contentText && <Markdown text={artifact.contentText} />}
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
          </>
        )}
      </div>
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
    return <p className="text-sm italic text-[var(--color-ink-dim)]">No artifacts yet.</p>;
  }

  return (
    <div className="grid gap-2">
      {artifacts.map(artifact => (
        <ArtifactEntry key={artifact.id} artifact={artifact} missionId={missionId} />
      ))}
    </div>
  );
}
