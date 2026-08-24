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
  useUpdateProjectResourceSource
} from '@/lib/queries';

import type {
  AgentCatalogAgentDto,
  AgentLaunchConfigDto,
  ProjectResourceDto,
  ProjectResourceSourceDto
} from '../../../../../shared/contract.ts';

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
  onSaved
}: {
  projectId: string;
  resource: ProjectResourceDto;
  source: ProjectResourceSourceDto;
  targetLabel: string;
  agents: AgentCatalogAgentDto[];
  onSaved: () => void;
}) {
  const createResource = useCreateProjectResource(projectId);
  const deleteSource = useDeleteProjectResourceSource(projectId);
  const updateSource = useUpdateProjectResourceSource(projectId);

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
          <span className="flex min-w-0 items-center gap-2">
            <Badge variant="outline" className="shrink-0 font-normal">
              {sourceKindLabel(source.sourceKind)}
            </Badge>
            <span className="min-w-0 truncate font-mono text-sm">{value || 'No descriptor'}</span>
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

        <div className="space-y-2">
          <div>
            <h5 className="text-xs font-medium">Agent settings</h5>
            <p className="text-[11px] text-muted-foreground">
              Applied when an objective uses this source and has no launch override of its own.
            </p>
          </div>
          <SourceAgentDefaultsTable
            agents={agents}
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
