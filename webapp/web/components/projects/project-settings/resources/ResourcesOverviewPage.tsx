import { AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  accessModeLabel,
  resourceStatusLabel
} from '@/components/projects/project-settings/resources/resource-display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  ANY_ELIGIBLE_EXECUTION_TARGET_VALUE,
  executionTargetOptionLabel,
  executionTargetOptionStatusSuffix,
  executionTargetSelectorDisplayLabel,
  parseExecutionTargetSelectorValue,
  resolveExecutionTargetSelectorValue
} from '@/lib/execution-target-selection';
import {
  useProject,
  useProjectExecutionTarget,
  useProjectResources,
  useUpdateProject,
  useUpdateProjectExecutionTarget
} from '@/lib/queries';

type ResourcesOverviewPageProps = {
  open: boolean;
  projectId: string;
  onSelectResource: (resourceId: string) => void;
  onAddResource: () => void;
};

/**
 * The landing page of the Resources section: project-wide run settings plus an
 * index of every linked resource. Each resource opens its own settings page.
 */
export function ResourcesOverviewPage({
  open,
  projectId,
  onSelectResource,
  onAddResource
}: ResourcesOverviewPageProps) {
  // Resolve the execution target from this page's own project rather than the board-scoped
  // ProjectRepositoryProvider: project settings can be opened from the sidebar for any project,
  // including while no board (and therefore no provider) is mounted.
  const executionTargetQ = useProjectExecutionTarget(projectId);
  const eligibleTargets = executionTargetQ.data?.eligibleTargets ?? [];
  const selectedExecutionTargetId = executionTargetQ.data?.selectedExecutionTargetId ?? null;
  const updateExecutionTarget = useUpdateProjectExecutionTarget(projectId);
  const resourcesQ = useProjectResources(projectId);
  const projectQ = useProject(projectId);
  const updateProject = useUpdateProject(projectId);

  const rows = open ? (resourcesQ.data ?? []) : [];
  const hasMissingPrimary = rows.some(
    resource => resource.isPrimary && resource.status === 'missing'
  );

  const [targetError, setTargetError] = useState<string | null>(null);

  // Project default/parent branch (stored in project settings). The input mirrors
  // the saved value; an empty value clears the setting (falls back to `main`).
  const savedDefaultBranch = projectQ.data?.defaultBranch ?? '';
  const [defaultBranchInput, setDefaultBranchInput] = useState(savedDefaultBranch);
  const [defaultBranchError, setDefaultBranchError] = useState<string | null>(null);
  const [defaultBranchSaved, setDefaultBranchSaved] = useState(false);
  useEffect(() => {
    setDefaultBranchInput(savedDefaultBranch);
  }, [savedDefaultBranch]);
  const defaultBranchDirty = defaultBranchInput.trim() !== savedDefaultBranch;

  async function handleSaveDefaultBranch() {
    if (!defaultBranchDirty) return;
    setDefaultBranchError(null);
    setDefaultBranchSaved(false);
    try {
      await updateProject.mutateAsync({ defaultBranch: defaultBranchInput.trim() || null });
      setDefaultBranchSaved(true);
    } catch (error) {
      setDefaultBranchError(
        error instanceof Error ? error.message : 'Failed to save default branch.'
      );
    }
  }

  function handleExecutionTargetChange(value: string | null) {
    setTargetError(null);
    updateExecutionTarget.mutate(
      { executionTargetId: !value ? null : parseExecutionTargetSelectorValue(value) },
      {
        onError: error => {
          setTargetError(
            error instanceof Error ? error.message : 'Failed to update execution target.'
          );
        }
      }
    );
  }

  const selectorValue = resolveExecutionTargetSelectorValue({
    selectedExecutionTargetId,
    eligibleTargets
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-medium">Resources</h2>
        <p className="text-sm text-muted-foreground">
          Choose where agents run for this project, then open a resource to manage its permission
          and the sources that back it per execution target.
        </p>
      </div>

      {eligibleTargets.length > 0 ? (
        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-medium">Execution target</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Runs queue on the selected device. When several targets are eligible and none is chosen,
            any online target with a connected primary may claim the work.
          </p>
          <div className="mt-3 grid max-w-md gap-1.5">
            <Label htmlFor="project-execution-target">Run agents on</Label>
            <Select value={selectorValue} onValueChange={handleExecutionTargetChange}>
              <SelectTrigger id="project-execution-target" className="h-8">
                <SelectValue placeholder="Select execution target">
                  {executionTargetSelectorDisplayLabel({
                    selectorValue,
                    eligibleTargets,
                    placeholder: 'Select execution target'
                  })}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {eligibleTargets.length > 1 ? (
                  <SelectItem value={ANY_ELIGIBLE_EXECUTION_TARGET_VALUE}>
                    Any eligible target
                  </SelectItem>
                ) : null}
                {eligibleTargets.map(target => (
                  <SelectItem
                    key={target.executionTargetId}
                    value={target.executionTargetId}
                    disabled={!target.reachable || !target.primaryResourceConnected}
                  >
                    {executionTargetOptionLabel(target)}
                    {executionTargetOptionStatusSuffix(target)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetError ? <p className="text-xs text-destructive">{targetError}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-medium">Default branch</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          The base branch new mission branches are cut from and the parent that{' '}
          <span className="font-medium">Merge with parent</span> advances. Leave blank to use the
          repository default (<code className="text-xs">main</code>).
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Label htmlFor="project-default-branch">Branch name</Label>
            <Input
              id="project-default-branch"
              value={defaultBranchInput}
              onChange={event => {
                setDefaultBranchInput(event.target.value);
                setDefaultBranchSaved(false);
                setDefaultBranchError(null);
              }}
              placeholder="main"
              className="h-8 min-w-0 flex-1 font-mono text-xs"
              disabled={projectQ.isLoading}
              onKeyDown={event => {
                if (event.key === 'Enter') void handleSaveDefaultBranch();
              }}
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={!defaultBranchDirty || updateProject.isPending}
            onClick={() => void handleSaveDefaultBranch()}
          >
            Save
          </Button>
        </div>
        {defaultBranchError ? (
          <p className="mt-2 text-xs text-destructive">{defaultBranchError}</p>
        ) : defaultBranchSaved && !defaultBranchDirty ? (
          <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">Saved.</p>
        ) : null}
      </div>

      {hasMissingPrimary ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            A primary working directory is missing. Set another resource as primary before launching
            agents from this project.
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Linked resources</h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={onAddResource}
        >
          <Plus className="size-3.5" />
          Add resource
        </Button>
      </div>

      {resourcesQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading resources…</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          <p>No resources linked yet.</p>
          <Button type="button" size="sm" className="h-8 gap-1.5" onClick={onAddResource}>
            <Plus className="size-3.5" />
            Add resource
          </Button>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {rows.map(resource => (
            <li key={resource.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/40"
                onClick={() => onSelectResource(resource.id)}
              >
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="truncate font-mono text-sm">{resource.resourceKey}</span>
                  {resource.isPrimary ? (
                    <Badge variant="secondary" className="shrink-0">
                      Primary
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className="shrink-0 font-normal">
                    {accessModeLabel(resource.accessMode)}
                  </Badge>
                  <Badge
                    variant={resource.status === 'missing' ? 'destructive' : 'outline'}
                    className="shrink-0 font-normal"
                  >
                    {resourceStatusLabel(resource.status)}
                  </Badge>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {resource.sources.length} {resource.sources.length === 1 ? 'source' : 'sources'}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
