import { FolderOpen, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  SOURCE_KIND_OPTIONS,
  type SourceKind
} from '@/components/projects/project-settings/resources/AddSourceForm';
import {
  ACCESS_MODE_OPTIONS,
  accessModeHelpText
} from '@/components/projects/project-settings/resources/resource-display';
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
import { Switch } from '@/components/ui/switch';
import { getDesktopBridge } from '@/lib/desktop-chrome';
import {
  ANY_ELIGIBLE_EXECUTION_TARGET_VALUE,
  executionTargetOptionLabel,
  executionTargetOptionStatusSuffix,
  executionTargetSelectorDisplayLabel,
  parseExecutionTargetSelectorValue
} from '@/lib/execution-target-selection';
import { writeLocalProjectMetadata } from '@/lib/project-metadata';
import {
  useCreateProjectResource,
  useLaunchSettings,
  useProjectExecutionTarget,
  useProjectResources
} from '@/lib/queries';
import { cn } from '@/lib/utils';

import type {
  ProjectResourceAccessMode,
  ProjectResourceDto
} from '../../../../../shared/contract.ts';

/**
 * Full-page form for creating a project resource and linking its first source.
 * On success the caller navigates to the new resource's own settings page.
 */
export function AddResourcePage({
  projectId,
  onCreated
}: {
  projectId: string;
  onCreated: (resource: ProjectResourceDto) => void;
}) {
  const resourcesQ = useProjectResources(projectId);
  const executionTargetQ = useProjectExecutionTarget(projectId);
  const launchSettingsQ = useLaunchSettings();
  const createResource = useCreateProjectResource(projectId);

  const resources = resourcesQ.data ?? [];
  const existingResourceKeys = resources.map(resource => resource.resourceKey);
  const isFirstResource = resources.length === 0;

  const eligibleTargets = executionTargetQ.data?.eligibleTargets ?? [];
  const activeExecutionTargetId =
    executionTargetQ.data?.selectedExecutionTargetId ??
    launchSettingsQ.data?.executionTargetId ??
    null;
  const defaultTargetValue =
    activeExecutionTargetId &&
    eligibleTargets.some(target => target.executionTargetId === activeExecutionTargetId)
      ? activeExecutionTargetId
      : ANY_ELIGIBLE_EXECUTION_TARGET_VALUE;

  const [name, setName] = useState('');
  const [sourceKind, setSourceKind] = useState<SourceKind>('local_checkout');
  const [directoryPath, setDirectoryPath] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [targetValue, setTargetValue] = useState(defaultTargetValue);
  const [makePrimary, setMakePrimary] = useState(isFirstResource);
  // coo:368: primary resources are always read & write; a non-primary resource
  // defaults to `read`.
  const [accessMode, setAccessMode] = useState<ProjectResourceAccessMode>(
    isFirstResource ? 'read_write' : 'read'
  );
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bridge = getDesktopBridge();
  const canBrowseDirectories = typeof bridge?.chooseDirectory === 'function';

  useEffect(() => setTargetValue(defaultTargetValue), [defaultTargetValue]);

  // Keep the permission consistent with the primary toggle: a primary resource
  // is always read & write.
  const effectiveAccessMode: ProjectResourceAccessMode = makePrimary ? 'read_write' : accessMode;
  const trimmedName = name.trim();
  const duplicateName = trimmedName.length > 0 && existingResourceKeys.includes(trimmedName);

  async function handleBrowseDirectory() {
    const chooseDirectory = bridge?.chooseDirectory;
    if (!chooseDirectory) return;
    setError(null);
    setIsBrowsing(true);
    try {
      const chosen = await chooseDirectory();
      if (chosen) setDirectoryPath(chosen);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to choose directory.');
    } finally {
      setIsBrowsing(false);
    }
  }

  async function handleCreate() {
    if (duplicateName) {
      setError('A resource with this name already exists. Add a source to it instead.');
      return;
    }
    // An explicit name must be unique; omitting it lets the backend derive one
    // from the path/URL. Primary is opt-in so adding a resource never silently
    // steals primary from an existing checkout unless the user asks for it.
    if (sourceKind === 'git') {
      const trimmedUrl = repoUrl.trim();
      if (!trimmedUrl) {
        setError('Enter a repository URL.');
        return;
      }
      setError(null);
      try {
        const created = await createResource.mutateAsync({
          sourceUrl: trimmedUrl,
          resourceKey: trimmedName || null,
          isPrimary: makePrimary,
          accessMode: effectiveAccessMode
        });
        onCreated(created);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add resource.');
      }
      return;
    }

    const trimmedPath = directoryPath.trim();
    if (!trimmedPath) {
      setError('Enter a directory path.');
      return;
    }
    setError(null);
    try {
      const created = await createResource.mutateAsync({
        directoryPath: trimmedPath,
        resourceKey: trimmedName || null,
        executionTargetId: parseExecutionTargetSelectorValue(targetValue),
        isPrimary: makePrimary,
        accessMode: effectiveAccessMode
      });
      // coo:368: `read` (reference) resources are never linked into
      // `.overlord/project.json`.
      if (created.accessMode !== 'read') {
        await writeLocalProjectMetadata({
          directoryPath: trimmedPath,
          projectId,
          resource: created
        });
      }
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add resource.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-medium">Add resource</h2>
        <p className="text-sm text-muted-foreground">
          Create a new logical resource for this project and link its first source. Leave the name
          blank to derive one from the path or URL.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <div className="grid gap-1.5 sm:max-w-md">
          <Label htmlFor="add-resource-name" className="text-xs">
            Name (optional)
          </Label>
          <Input
            id="add-resource-name"
            value={name}
            onChange={event => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder="e.g. frontend"
            className="h-8 font-mono text-xs"
          />
          {duplicateName ? (
            <p className="text-[11px] text-destructive">
              A resource with this name already exists.
            </p>
          ) : null}
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">Source type</Label>
          <div
            role="radiogroup"
            aria-label="Source type"
            className="inline-flex w-fit rounded-md border p-0.5"
          >
            {SOURCE_KIND_OPTIONS.map(option => {
              const Icon = option.icon;
              const active = sourceKind === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setSourceKind(option.value);
                    setError(null);
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="size-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {sourceKind === 'git' ? (
          <div className="grid gap-1.5 sm:max-w-md">
            <Label htmlFor="add-resource-url" className="text-xs">
              Repository URL
            </Label>
            <Input
              id="add-resource-url"
              value={repoUrl}
              onChange={event => setRepoUrl(event.target.value)}
              placeholder="https://github.com/org/repo.git"
              className="h-8 font-mono text-xs"
              onKeyDown={event => {
                if (event.key === 'Enter') void handleCreate();
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              Repo sources are shared across all execution targets for this project.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-1.5 sm:max-w-md">
              <Label htmlFor="add-resource-path" className="text-xs">
                Directory path
              </Label>
              <div className="flex gap-2">
                <Input
                  id="add-resource-path"
                  value={directoryPath}
                  onChange={event => setDirectoryPath(event.target.value)}
                  placeholder="/path/to/checkout"
                  className="h-8 min-w-0 flex-1 font-mono text-xs"
                  onKeyDown={event => {
                    if (event.key === 'Enter') void handleCreate();
                  }}
                />
                {canBrowseDirectories ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5"
                    disabled={isBrowsing}
                    onClick={() => void handleBrowseDirectory()}
                  >
                    <FolderOpen className="size-3.5" />
                    Browse
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="grid gap-1.5 sm:max-w-md">
              <Label htmlFor="add-resource-target" className="text-xs">
                Execution target
              </Label>
              <Select
                value={targetValue}
                onValueChange={value => setTargetValue(value ?? targetValue)}
              >
                <SelectTrigger id="add-resource-target" className="h-8">
                  <SelectValue placeholder="Execution target">
                    {executionTargetSelectorDisplayLabel({
                      selectorValue: targetValue,
                      eligibleTargets,
                      anyLabel: 'Any target'
                    })}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_ELIGIBLE_EXECUTION_TARGET_VALUE}>Any target</SelectItem>
                  {eligibleTargets.map(target => (
                    <SelectItem key={target.executionTargetId} value={target.executionTargetId}>
                      {executionTargetOptionLabel(target)}
                      {executionTargetOptionStatusSuffix(target)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <div className="flex items-center justify-between gap-2 sm:max-w-md">
          <div className="grid gap-0.5">
            <Label htmlFor="add-resource-primary" className="text-xs">
              Set as primary resource
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Primary backs the default working directory agents run in.
            </p>
          </div>
          <Switch
            id="add-resource-primary"
            checked={makePrimary}
            onCheckedChange={setMakePrimary}
          />
        </div>

        <div className="grid gap-1.5 sm:max-w-md">
          <Label className="text-xs">Permission</Label>
          <div
            role="radiogroup"
            aria-label="Resource permission"
            className="inline-flex w-fit rounded-md border p-0.5"
          >
            {ACCESS_MODE_OPTIONS.map(option => {
              const active = effectiveAccessMode === option.value;
              // A primary resource is pinned to read & write.
              const locked = makePrimary && option.value === 'read';
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={locked}
                  onClick={() => {
                    setAccessMode(option.value);
                    setError(null);
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                    locked && 'cursor-not-allowed opacity-40'
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {makePrimary
              ? 'Primary resources are always read & write.'
              : accessModeHelpText(effectiveAccessMode)}
          </p>
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <Button
          type="button"
          className="gap-1.5"
          disabled={createResource.isPending || duplicateName}
          onClick={() => void handleCreate()}
        >
          <Plus className="size-3.5" />
          Add resource
        </Button>
      </div>
    </div>
  );
}
