import { AlertTriangle, Check, Copy, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AddSourceForm } from '@/components/projects/project-settings/resources/AddSourceForm';
import {
  ACCESS_MODE_OPTIONS,
  accessModeHelpText,
  accessModeLabel,
  resourceStatusLabel,
  sourceDescriptorValue,
  sourceKindLabel,
  targetLabelForId
} from '@/components/projects/project-settings/resources/resource-display';
import { ResourceSourceRow } from '@/components/projects/project-settings/resources/ResourceSourceRow';
import { Accordion } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ANY_ELIGIBLE_EXECUTION_TARGET_VALUE } from '@/lib/execution-target-selection';
import { useCopyToClipboard } from '@/lib/hooks/use-copy-to-clipboard';
import { writeLocalProjectMetadata } from '@/lib/project-metadata';
import {
  useAgentCatalog,
  useDeleteProjectResource,
  useLaunchSettings,
  useProject,
  useProjectExecutionTarget,
  useProjectResources,
  useUpdateProjectResource
} from '@/lib/queries';
import { cn } from '@/lib/utils';

import type { ProjectResourceAccessMode } from '../../../../../shared/contract.ts';

/**
 * The settings page for a single project resource: name, permission, resource
 * id, the sources that materialize it per execution target, and deletion.
 */
export function ResourceDetailPage({
  projectId,
  resourceId,
  onDeleted
}: {
  projectId: string;
  resourceId: string;
  onDeleted: () => void;
}) {
  const resourcesQ = useProjectResources(projectId);
  const executionTargetQ = useProjectExecutionTarget(projectId);
  const launchSettingsQ = useLaunchSettings();
  const agentCatalogQ = useAgentCatalog();
  const projectQ = useProject(projectId);
  const updateResource = useUpdateProjectResource(projectId);
  const deleteResource = useDeleteProjectResource(projectId);
  const { copied, copy } = useCopyToClipboard();

  const resource = (resourcesQ.data ?? []).find(candidate => candidate.id === resourceId) ?? null;

  const [nameDraft, setNameDraft] = useState(resource?.resourceKey ?? '');
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setNameDraft(resource?.resourceKey ?? '');
    setError(null);
  }, [resource?.id, resource?.resourceKey]);

  if (!resource) {
    return (
      <p className="text-sm text-muted-foreground">
        {resourcesQ.isLoading ? 'Loading resource…' : 'This resource is no longer available.'}
      </p>
    );
  }

  const eligibleTargets = executionTargetQ.data?.eligibleTargets ?? [];
  const localExecutionTargetId = launchSettingsQ.data?.executionTargetId ?? null;
  const deviceLabel = launchSettingsQ.data?.deviceLabel ?? 'This device';
  const activeExecutionTargetId =
    executionTargetQ.data?.selectedExecutionTargetId ?? localExecutionTargetId;
  const addSourceDefaultValue =
    activeExecutionTargetId &&
    eligibleTargets.some(target => target.executionTargetId === activeExecutionTargetId)
      ? activeExecutionTargetId
      : ANY_ELIGIBLE_EXECUTION_TARGET_VALUE;

  const nameDirty = nameDraft.trim() !== resource.resourceKey;

  const handleSaveName = async () => {
    const nextKey = nameDraft.trim();
    if (!nextKey || nextKey === resource.resourceKey) return;
    setError(null);
    try {
      await updateResource.mutateAsync({ resourceId: resource.id, body: { resourceKey: nextKey } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename resource.');
    }
  };

  const handleSetAccessMode = async (accessMode: ProjectResourceAccessMode) => {
    // Primary resources are pinned to read & write; nothing to toggle.
    if (resource.isPrimary || resource.accessMode === accessMode) return;
    setError(null);
    try {
      await updateResource.mutateAsync({ resourceId: resource.id, body: { accessMode } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update resource permission.');
    }
  };

  const handleSetPrimary = async () => {
    if (resource.isPrimary) return;
    setError(null);
    try {
      const updated = await updateResource.mutateAsync({
        resourceId: resource.id,
        body: { isPrimary: true }
      });
      if (updated.accessMode !== 'read' && updated.path.trim()) {
        await writeLocalProjectMetadata({
          directoryPath: updated.path,
          projectId,
          projectName: projectQ.data?.name,
          resource: updated
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update primary resource.');
    }
  };

  const handleDelete = async () => {
    setDeleteError(null);
    try {
      await deleteResource.mutateAsync(resource.id);
      setDeleteOpen(false);
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to remove resource.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-medium">{resource.resourceKey}</h2>
          {resource.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
          <Badge variant="outline" className="font-normal">
            {accessModeLabel(resource.accessMode)}
          </Badge>
          <Badge
            variant={resource.status === 'missing' ? 'destructive' : 'outline'}
            className="font-normal"
          >
            {resourceStatusLabel(resource.status)}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Name this resource, choose what agents may do with it, and manage the sources that back it
          on each execution target.
        </p>
      </div>

      {resource.isPrimary && resource.status === 'missing' ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            This primary working directory is missing. Fix its source path or make another resource
            primary before launching agents.
          </p>
        </div>
      ) : null}

      <div className="space-y-4 rounded-lg border p-4">
        <div className="grid gap-1.5 sm:max-w-md">
          <Label htmlFor="resource-name" className="text-xs">
            Name
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="resource-name"
              value={nameDraft}
              onChange={event => setNameDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') void handleSaveName();
                if (event.key === 'Escape') setNameDraft(resource.resourceKey);
              }}
              className="h-8 min-w-0 font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!nameDirty || updateResource.isPending}
              onClick={() => void handleSaveName()}
            >
              Save
            </Button>
            {!resource.isPrimary ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                disabled={updateResource.isPending}
                onClick={() => void handleSetPrimary()}
              >
                Make primary
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Agents and the CLI address this resource by name (its resource key).
          </p>
        </div>

        <div className="grid gap-1.5 sm:max-w-md">
          <Label className="text-xs">Permission</Label>
          <div
            role="radiogroup"
            aria-label={`Permission for ${resource.resourceKey}`}
            className="inline-flex w-fit rounded-md border p-0.5"
          >
            {ACCESS_MODE_OPTIONS.map(option => {
              const active = resource.accessMode === option.value;
              // Primary resources are pinned to read & write.
              const locked = resource.isPrimary;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={locked || updateResource.isPending}
                  onClick={() => void handleSetAccessMode(option.value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                    locked && !active && 'cursor-not-allowed opacity-40'
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {resource.isPrimary
              ? 'Primary resources are always read & write.'
              : accessModeHelpText(resource.accessMode)}
          </p>
        </div>

        <div className="grid gap-1.5 sm:max-w-md">
          <Label htmlFor="resource-id" className="text-xs">
            Resource ID
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="resource-id"
              value={resource.id}
              readOnly
              className="h-8 min-w-0 font-mono text-xs text-muted-foreground"
              onFocus={event => event.currentTarget.select()}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-8 shrink-0"
              aria-label="Copy resource ID"
              onClick={() => void copy(resource.id)}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Sources</h3>
        {resource.sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sources linked yet. Add one below so agents can materialize this resource.
          </p>
        ) : (
          <Accordion multiple className="overflow-hidden rounded-lg border px-4">
            {resource.sources.map(source => (
              <ResourceSourceRow
                key={source.id}
                projectId={projectId}
                resource={resource}
                source={source}
                targetLabel={targetLabelForId({
                  executionTargetId: source.executionTargetId,
                  eligibleTargets,
                  localExecutionTargetId,
                  deviceLabel
                })}
                agents={agentCatalogQ.data?.agents ?? []}
                onSaved={() => void resourcesQ.refetch()}
              />
            ))}
          </Accordion>
        )}
      </div>

      <AddSourceForm
        projectId={projectId}
        resource={resource}
        eligibleTargets={eligibleTargets}
        defaultTargetValue={addSourceDefaultValue}
        onAdded={() => void resourcesQ.refetch()}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4">
        <div>
          <h3 className="text-sm font-medium">Delete resource</h3>
          <p className="text-sm text-muted-foreground">
            Removes this resource and all of its sources from the project. The files on disk are
            left untouched.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          className="gap-1.5"
          onClick={() => {
            setDeleteError(null);
            setDeleteOpen(true);
          }}
        >
          <Trash2 className="size-4" />
          Delete resource
        </Button>
      </div>

      <Dialog
        open={deleteOpen}
        onOpenChange={nextOpen => {
          setDeleteOpen(nextOpen);
          if (!nextOpen) setDeleteError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete resource</DialogTitle>
            <DialogDescription>
              Remove resource &ldquo;{resource.resourceKey}&rdquo; and all of its sources from this
              project?
              {resource.sources.length ? (
                <span className="mt-2 block font-mono text-xs text-muted-foreground">
                  {resource.sources
                    .map(
                      source => sourceDescriptorValue(source) || sourceKindLabel(source.sourceKind)
                    )
                    .join(' · ')}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteResource.isPending}
              onClick={() => void handleDelete()}
            >
              Delete resource
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
