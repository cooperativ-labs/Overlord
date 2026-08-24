import { FolderOpen, GitBranch, HardDrive, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

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
import { getDesktopBridge } from '@/lib/desktop-chrome';
import {
  ANY_ELIGIBLE_EXECUTION_TARGET_VALUE,
  executionTargetOptionLabel,
  executionTargetOptionStatusSuffix,
  executionTargetSelectorDisplayLabel,
  parseExecutionTargetSelectorValue
} from '@/lib/execution-target-selection';
import { writeLocalProjectMetadata } from '@/lib/project-metadata';
import { useCreateProjectResource } from '@/lib/queries';
import { cn } from '@/lib/utils';

import type {
  EligibleExecutionTargetDto,
  ProjectResourceDto
} from '../../../../../shared/contract.ts';

export type SourceKind = 'local_checkout' | 'git';

export const SOURCE_KIND_OPTIONS: { value: SourceKind; label: string; icon: typeof HardDrive }[] = [
  { value: 'local_checkout', label: 'Local path', icon: HardDrive },
  { value: 'git', label: 'Repo URL', icon: GitBranch }
];

export function AddSourceForm({
  projectId,
  resource,
  eligibleTargets,
  defaultTargetValue,
  onAdded
}: {
  projectId: string;
  resource: ProjectResourceDto;
  eligibleTargets: EligibleExecutionTargetDto[];
  defaultTargetValue: string;
  onAdded: () => void;
}) {
  const createResource = useCreateProjectResource(projectId);
  // A source is unique per (resource, execution target, kind). Local checkouts are
  // scoped per target; a git source is project-global (one per resource). We use
  // these sets to keep the add flow from creating a duplicate combination — the
  // backend would silently replace it, which is confusing. Users edit instead.
  const usedLocalTargetIds = new Set<string | null>(
    resource.sources
      .filter(source => source.sourceKind === 'local_checkout')
      .map(source => source.executionTargetId)
  );
  const hasGitSource = resource.sources.some(source => source.sourceKind === 'git');

  const isLocalTargetInUse = (selectorValue: string) =>
    usedLocalTargetIds.has(parseExecutionTargetSelectorValue(selectorValue));

  // Prefer a target that does not already have a local source so the default
  // selection is immediately usable.
  function firstAvailableTargetValue(): string {
    if (!isLocalTargetInUse(defaultTargetValue)) return defaultTargetValue;
    if (!usedLocalTargetIds.has(null)) return ANY_ELIGIBLE_EXECUTION_TARGET_VALUE;
    const available = eligibleTargets.find(
      target => !usedLocalTargetIds.has(target.executionTargetId)
    );
    return available ? available.executionTargetId : defaultTargetValue;
  }

  const [sourceKind, setSourceKind] = useState<SourceKind>('local_checkout');
  const [directoryPath, setDirectoryPath] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [targetValue, setTargetValue] = useState(() => firstAvailableTargetValue());
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bridge = getDesktopBridge();
  const canBrowseDirectories = typeof bridge?.chooseDirectory === 'function';

  useEffect(() => {
    setTargetValue(firstAvailableTargetValue());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultTargetValue, resource.sources]);

  const selectedTargetInUse = sourceKind === 'local_checkout' && isLocalTargetInUse(targetValue);
  const gitAlreadyExists = sourceKind === 'git' && hasGitSource;
  const addDisabled = createResource.isPending || selectedTargetInUse || gitAlreadyExists;

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

  async function handleAddSource() {
    if (sourceKind === 'git') {
      if (hasGitSource) {
        setError('This resource already has a repo source. Edit it instead.');
        return;
      }
      const trimmedUrl = repoUrl.trim();
      if (!trimmedUrl) {
        setError('Enter a repository URL.');
        return;
      }
      setError(null);
      try {
        // Git sources are project-global; they are not scoped to an execution target.
        await createResource.mutateAsync({
          sourceUrl: trimmedUrl,
          resourceKey: resource.resourceKey,
          isPrimary: resource.isPrimary
        });
        setRepoUrl('');
        onAdded();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add source.');
      }
      return;
    }

    if (selectedTargetInUse) {
      setError('This execution target already has a local source. Edit it instead.');
      return;
    }
    const trimmed = directoryPath.trim();
    if (!trimmed) {
      setError('Enter a directory path.');
      return;
    }
    setError(null);
    try {
      const executionTargetId = parseExecutionTargetSelectorValue(targetValue);
      const created = await createResource.mutateAsync({
        directoryPath: trimmed,
        resourceKey: resource.resourceKey,
        executionTargetId,
        isPrimary: resource.isPrimary
      });
      // coo:368: `read` (reference) resources are never linked into project.json.
      if (created.accessMode !== 'read') {
        await writeLocalProjectMetadata({ directoryPath: trimmed, projectId, resource: created });
      }
      setDirectoryPath('');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add source.');
    }
  }

  return (
    <div className="rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">Add source</h4>
        <div
          role="radiogroup"
          aria-label="Source type"
          className="inline-flex rounded-md border p-0.5"
        >
          {SOURCE_KIND_OPTIONS.map(option => {
            const Icon = option.icon;
            const active = sourceKind === option.value;
            // A resource already backed by a repo source cannot take a second one.
            const optionDisabled = option.value === 'git' && hasGitSource;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={optionDisabled}
                title={optionDisabled ? 'This resource already has a repo source' : undefined}
                onClick={() => {
                  setSourceKind(option.value);
                  setError(null);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                  optionDisabled && 'cursor-not-allowed opacity-40 hover:text-muted-foreground'
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
        <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={`add-source-url-${resource.id}`} className="text-xs">
              Repository URL
            </Label>
            <Input
              id={`add-source-url-${resource.id}`}
              value={repoUrl}
              onChange={event => setRepoUrl(event.target.value)}
              placeholder="https://github.com/org/repo.git"
              className="h-8 min-w-0 flex-1 font-mono text-xs"
              onKeyDown={event => {
                if (event.key === 'Enter') void handleAddSource();
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              Repo sources are shared across all execution targets for this project.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5"
            disabled={addDisabled}
            onClick={() => void handleAddSource()}
          >
            <Plus className="size-3.5" />
            Add source
          </Button>
        </div>
      ) : (
        <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem_auto] lg:items-end">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={`add-source-path-${resource.id}`} className="text-xs">
              Directory path
            </Label>
            <div className="flex gap-2">
              <Input
                id={`add-source-path-${resource.id}`}
                value={directoryPath}
                onChange={event => setDirectoryPath(event.target.value)}
                placeholder="/path/to/checkout"
                className="h-8 min-w-0 flex-1 font-mono text-xs"
                onKeyDown={event => {
                  if (event.key === 'Enter') void handleAddSource();
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
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={`add-source-target-${resource.id}`} className="text-xs">
              Execution target
            </Label>
            <Select
              value={targetValue}
              onValueChange={value => setTargetValue(value ?? targetValue)}
            >
              <SelectTrigger id={`add-source-target-${resource.id}`} className="h-8">
                <SelectValue placeholder="Execution target">
                  {executionTargetSelectorDisplayLabel({
                    selectorValue: targetValue,
                    eligibleTargets,
                    anyLabel: 'Any target'
                  })}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value={ANY_ELIGIBLE_EXECUTION_TARGET_VALUE}
                  disabled={usedLocalTargetIds.has(null)}
                >
                  Any target{usedLocalTargetIds.has(null) ? ' (in use)' : ''}
                </SelectItem>
                {eligibleTargets.map(target => {
                  const inUse = usedLocalTargetIds.has(target.executionTargetId);
                  return (
                    <SelectItem
                      key={target.executionTargetId}
                      value={target.executionTargetId}
                      disabled={inUse}
                    >
                      {executionTargetOptionLabel(target)}
                      {inUse ? ' (in use)' : executionTargetOptionStatusSuffix(target)}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5"
            disabled={addDisabled}
            onClick={() => void handleAddSource()}
          >
            <Plus className="size-3.5" />
            Add source
          </Button>
        </div>
      )}
      {selectedTargetInUse ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          This execution target already has a local source. Edit the existing source above instead
          of adding a duplicate.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
