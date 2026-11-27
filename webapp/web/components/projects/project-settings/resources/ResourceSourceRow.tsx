import type {
  AgentCatalogAgentDto,
  AgentLaunchConfigDto,
  ProjectResourceDto,
  ProjectResourceSourceDto
} from '@overlord/contract';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  sourceDescriptorValue,
  sourceKindLabel
} from '@/components/projects/project-settings/resources/resource-display';
import { SourceAgentDefaultsTable } from '@/components/projects/project-settings/resources/SourceAgentDefaultsTable';
import { AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { writeLocalProjectMetadata } from '@/lib/project-metadata';
import {
  useCreateProjectResource,
  useDeleteProjectResourceSource,
  useUpdateProjectResourceLatchHost,
  useUpdateProjectResourceSource
} from '@/lib/queries';

/**
 * One source of a resource, presented as an accordion row: the collapsed
 * trigger carries the path and its execution target, and expanding it reveals
 * the editable path plus the per-agent launch defaults stored on the source.
 */
export function ResourceSourceRow({
  projectId,
  resource,
  source,
  targetLabel,
  agents,
  agentsLoading = false,
  onSaved
}: {
  projectId: string;
  resource: ProjectResourceDto;
  source: ProjectResourceSourceDto;
  targetLabel: string;
  agents: AgentCatalogAgentDto[];
  agentsLoading?: boolean;
  onSaved: () => void;
}) {
  const createResource = useCreateProjectResource(projectId);
  const deleteSource = useDeleteProjectResourceSource(projectId);
  const updateSource = useUpdateProjectResourceSource(projectId);

  const updateLatchHost = useUpdateProjectResourceLatchHost(projectId);
  const link = source.latchHostLink;
  const [hostKey, setHostKey] = useState('');
  const [sharedRootId, setSharedRootId] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  const value = sourceDescriptorValue(source);
  const isGit = source.sourceKind === 'git';
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [launchDefaults, setLaunchDefaults] = useState(source.launchDefaults ?? {});

  useEffect(() => setDraft(value), [value]);
  useEffect(() => setLaunchDefaults(source.launchDefaults ?? {}), [source.launchDefaults]);

  const pathDirty = draft.trim() !== value;

  async function handleLaunchDefaultCommit({
    agentKey,
    config
  }: {
    agentKey: string;
    config: AgentLaunchConfigDto;
  }) {
    const next = { ...launchDefaults };
    if (config.preCommand.trim() || config.flags.length > 0) next[agentKey] = config;
    else delete next[agentKey];
    setLaunchDefaults(next);
    setError(null);
    try {
      await updateSource.mutateAsync({
        resourceId: resource.id,
        sourceId: source.id,
        body: { launchDefaults: next }
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent settings.');
    }
  }

  async function handleLatchHostUpdate(key: string | null, rootId?: string | null) {
    if (!link) return;
    setLinkError(null);
    try {
      await updateLatchHost.mutateAsync({
        resourceId: resource.id,
        sourceId: source.id,
        body: {
          sourceRevision: link.sourceRevision,
          hostPublicKey: key,
          ...(rootId === undefined ? {} : { sharedRootId: rootId })
        }
      });
      setHostKey('');
      setSharedRootId('');
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to update the Latch host link.');
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await deleteSource.mutateAsync({ resourceId: resource.id, sourceId: source.id });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove source.');
    }
  }

  // Saving re-runs the create/upsert with the source's own execution target and
  // kind, so the backend updates the existing descriptor in place rather than
  // adding a second source for the same resource-target combination.
  async function handleSavePath() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError(isGit ? 'Enter a repository URL.' : 'Enter a directory path.');
      return;
    }
    if (trimmed === value) return;
    setError(null);
    try {
      if (isGit) {
        await createResource.mutateAsync({
          sourceUrl: trimmed,
          resourceKey: resource.resourceKey,
          executionTargetId: source.executionTargetId,
          isPrimary: resource.isPrimary
        });
      } else {
        const created = await createResource.mutateAsync({
          directoryPath: trimmed,
          resourceKey: resource.resourceKey,
          executionTargetId: source.executionTargetId,
          isPrimary: resource.isPrimary
        });
        // coo:368: `read` (reference) resources are never linked into project.json.
        if (created.accessMode !== 'read') {
          await writeLocalProjectMetadata({ directoryPath: trimmed, projectId, resource: created });
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update source.');
    }
  }

  return (
    <AccordionItem value={source.id}>
      <AccordionTrigger className="gap-3 hover:no-underline">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-start gap-2">
            <Badge variant="outline" className="shrink-0 font-normal">
              {sourceKindLabel(source.sourceKind)}
            </Badge>
            <span className="min-w-0 font-mono text-sm break-all">{value || 'No descriptor'}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{targetLabel}</span>
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            Expand for agent settings
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`source-path-${source.id}`} className="text-xs">
            {isGit ? 'Repository URL' : 'Directory path'}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id={`source-path-${source.id}`}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              placeholder={isGit ? 'https://github.com/org/repo.git' : '/path/to/checkout'}
              className="h-8 min-w-0 flex-1 font-mono text-xs"
              onKeyDown={event => {
                if (event.key === 'Enter') void handleSavePath();
                if (event.key === 'Escape') setDraft(value);
              }}
            />
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={!pathDirty || createResource.isPending}
              onClick={() => void handleSavePath()}
            >
              Save
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
              disabled={deleteSource.isPending}
              onClick={() => void handleDelete()}
              aria-label={`Remove source ${value || sourceKindLabel(source.sourceKind)}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        {link && (
          <div className="space-y-2">
            <h5 className="text-xs font-medium">Latch host</h5>
            <p className="text-xs text-muted-foreground">
              {link.state === 'linked'
                ? `Verified host ${link.hostPublicKey?.slice(0, 12)}…`
                : link.state === 'ambiguous'
                  ? 'Multiple host or source matches. This source is unavailable in project Git.'
                  : 'This source has no verified Latch host.'}
            </p>
            {link.canVerify ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`latch-host-${source.id}`} className="text-xs">
                  Latch host public key
                </Label>
                <p className="text-xs text-muted-foreground">
                  On the intended host, run <code>latch remote-access status --json</code> and copy
                  its <code>publicKey</code>.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    id={`latch-host-${source.id}`}
                    value={hostKey}
                    onChange={event => setHostKey(event.target.value)}
                    className="h-8 min-w-0 flex-1 font-mono text-xs"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={64}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!/^[0-9a-f]{64}$/.test(hostKey.trim()) || updateLatchHost.isPending}
                    onClick={() => void handleLatchHostUpdate(hostKey.trim())}
                  >
                    {link.canUnlink ? 'Verify and relink' : 'Verify and link'}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Verification requires one active native Overlord runner on this target.
              </p>
            )}
            {link.canUnlink && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={updateLatchHost.isPending}
                onClick={() => void handleLatchHostUpdate(null)}
              >
                Unlink Latch host
              </Button>
            )}
            {(link.hostPublicKey || link.canUnlinkSharedRoot) && (
              <div className="grid gap-1.5">
                <h5 className="text-xs font-medium">Project Files</h5>
                <p className="text-xs text-muted-foreground">
                  {link.sharedRootId
                    ? 'A shared root is linked. Latch checks the current device grant on each read.'
                    : link.canUnlinkSharedRoot
                      ? 'The linked root is unavailable while the host match is ambiguous.'
                      : 'No shared root is linked.'}
                </p>
                {link.canVerify && link.hostPublicKey && (
                  <>
                    <Label htmlFor={`latch-root-${source.id}`} className="text-xs">
                      Shared root ID
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      On the Latch host, run{' '}
                      <code>latch remote-access share-root DEVICE_ID /path/to/source</code> for a
                      paired Control device and enter the resulting root ID.
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`latch-root-${source.id}`}
                        value={sharedRootId}
                        onChange={event => setSharedRootId(event.target.value)}
                        className="h-8 min-w-0 flex-1 font-mono text-xs"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={64}
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          !/^[0-9a-f]{64}$/.test(sharedRootId.trim()) || updateLatchHost.isPending
                        }
                        onClick={() =>
                          void handleLatchHostUpdate(
                            link.hostPublicKey ?? null,
                            sharedRootId.trim()
                          )
                        }
                      >
                        {link.sharedRootId ? 'Relink shared root' : 'Link shared root'}
                      </Button>
                    </div>
                  </>
                )}
                {link.canUnlinkSharedRoot && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="justify-self-start"
                    disabled={updateLatchHost.isPending}
                    onClick={() => void handleLatchHostUpdate(null, null)}
                  >
                    Unlink shared root
                  </Button>
                )}
              </div>
            )}
            {linkError && (
              <p role="alert" className="text-xs text-destructive">
                {linkError}
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div>
            <h5 className="text-xs font-medium">Agent settings</h5>
            <p className="text-[11px] text-muted-foreground">
              Every agent in this workspace&apos;s catalog can be configured here. Values are
              applied when an objective uses this source and has no launch override of its own.
            </p>
          </div>
          <SourceAgentDefaultsTable
            agents={agents}
            agentsLoading={agentsLoading}
            launchDefaults={launchDefaults}
            disabled={updateSource.isPending}
            onCommit={handleLaunchDefaultCommit}
          />
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </AccordionContent>
    </AccordionItem>
  );
}
