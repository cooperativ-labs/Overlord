import type {
  ProjectResourceReadCatalog,
  ProjectResourceReadRequest,
  ProjectResourceReadResult,
  RepositoryDiffData,
  RepositoryDirectoryData,
  RepositoryFileData,
  RepositoryGitStatusData
} from '@overlord/contract';
import { onlineManager, queryOptions, useQueries, useQuery } from '@tanstack/react-query';
import { FileText, Folder, GitBranch } from 'lucide-react';
import { useContext, useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { ResourceAccountContext } from '@/lib/resource-account';

type Resource = ProjectResourceReadCatalog[number];
type Source = Resource['sources'][number];

function readOptions(
  projectId: string,
  request: ProjectResourceReadRequest | null,
  accountId: string | null,
  disabledKey?: string
) {
  return queryOptions({
    queryKey: ['project-resource-read', accountId, projectId, request ?? disabledKey],
    queryFn: ({ signal }) => api.readProjectResource(projectId, request!, signal),
    enabled: request !== null,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false
  });
}

function useRead(
  projectId: string,
  request: ProjectResourceReadRequest | null,
  accountId: string | null
) {
  return useQuery(readOptions(projectId, request, accountId));
}

function ReadError({ error, result }: { error: Error | null; result?: ProjectResourceReadResult }) {
  const message = error?.message ?? result?.message;
  return message ? (
    <p role="status" className="text-sm text-muted-foreground">
      {message}
    </p>
  ) : null;
}

function Preview({ text }: { text: string }) {
  return (
    <pre className="max-h-[42vh] overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
      {text}
    </pre>
  );
}

type Binding = Pick<
  ProjectResourceReadRequest,
  'sourceId' | 'sourceRevision' | 'executionTargetId' | 'resourceKey'
>;

function GitChanges({
  projectId,
  binding,
  statusRead
}: {
  projectId: string;
  binding: Binding;
  statusRead: ReturnType<typeof useRead>;
}) {
  const accountId = useContext(ResourceAccountContext);
  const [diff, setDiff] = useState<{
    relativePath: string;
    scope: 'staged' | 'unstaged' | 'all';
  } | null>(null);
  const result = statusRead.data;
  const status =
    !statusRead.isError && result?.outcome === 'ok'
      ? (result.data as unknown as RepositoryGitStatusData)
      : null;
  const diffRead = useRead(
    projectId,
    status && diff ? { ...binding, ...diff, operation: 'diff' } : null,
    accountId
  );
  const diffData =
    !diffRead.isError && diffRead.data?.outcome === 'ok'
      ? (diffRead.data.data as unknown as RepositoryDiffData)
      : null;

  const sections = status
    ? [
        { label: 'Staged', paths: status.staged, scope: 'staged' as const },
        { label: 'Unstaged', paths: status.unstaged, scope: 'unstaged' as const },
        { label: 'Conflicts', paths: status.conflicted, scope: 'all' as const }
      ]
    : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {status && <span className="font-medium">{status.branch ?? 'Detached HEAD'}</span>}
        {status?.upstream && (
          <span className="text-muted-foreground">{status.upstream} (last fetched)</span>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={statusRead.isFetching}
          onClick={() => {
            setDiff(null);
            void statusRead.refetch();
          }}
        >
          Refresh status
        </Button>
      </div>
      {statusRead.isFetching ? (
        <p role="status">Reading Git status…</p>
      ) : (
        <ReadError error={statusRead.error} result={result} />
      )}
      {!statusRead.isFetching && status && (
        <>
          {result?.truncated && <p>Showing a partial status.</p>}
          {sections.every(section => section.paths.length === 0) && !status.untracked.length && (
            <p className="text-muted-foreground">Working tree is clean.</p>
          )}
          {sections.map(
            ({ label, paths, scope }) =>
              paths.length > 0 && (
                <div key={label}>
                  <h4 className="mb-1 text-sm font-medium">{label}</h4>
                  <ul>
                    {paths.map(change => (
                      <li key={change.path}>
                        <button
                          type="button"
                          className="max-w-full break-all rounded px-2 py-1 text-left font-mono text-xs hover:bg-muted aria-pressed:bg-muted"
                          aria-pressed={diff?.relativePath === change.path && diff.scope === scope}
                          onClick={() => setDiff({ relativePath: change.path, scope })}
                        >
                          {change.originalPath ? `${change.originalPath} → ` : ''}
                          {change.path}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
          )}
          {status.untracked.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium">Untracked</h4>
              <ul className="space-y-1 break-all font-mono text-xs">
                {status.untracked.map(file => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            </div>
          )}
          {diff && (
            <section className="space-y-2 border-t pt-3" aria-label="File diff">
              <h4 className="break-all font-medium">
                {diff.relativePath} ({diff.scope})
              </h4>
              {diffRead.isFetching && <p role="status">Reading diff…</p>}
              <ReadError error={diffRead.error} result={diffRead.data} />
              {diffData && (
                <>
                  {diffRead.data?.truncated && <p>Showing a truncated diff.</p>}
                  {diffData.excludedPaths.length > 0 && (
                    <p>The runner withheld sensitive content.</p>
                  )}
                  {diffData.diff ? (
                    <Preview text={diffData.diff} />
                  ) : (
                    <p>No diff text available.</p>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Files({ projectId, binding }: { projectId: string; binding: Binding }) {
  const accountId = useContext(ResourceAccountContext);
  const [folder, setFolder] = useState('');
  const [pages, setPages] = useState([0]);
  const [file, setFile] = useState<string | null>(null);
  const directoryRead = useRead(
    projectId,
    {
      ...binding,
      operation: 'list_directory',
      relativePath: folder,
      offset: pages.at(-1)!
    },
    accountId
  );
  const fileRead = useRead(
    projectId,
    file ? { ...binding, operation: 'read_file', relativePath: file } : null,
    accountId
  );
  const directory =
    !directoryRead.isError && directoryRead.data?.outcome === 'ok'
      ? (directoryRead.data.data as unknown as RepositoryDirectoryData)
      : null;
  const content =
    !fileRead.isError && fileRead.data?.outcome === 'ok'
      ? (fileRead.data.data as unknown as RepositoryFileData)
      : null;

  function openFolder(relativePath: string) {
    setFolder(relativePath);
    setPages([0]);
    setFile(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {folder && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openFolder(folder.split('/').slice(0, -1).join('/'))}
          >
            Up
          </Button>
        )}
        <span className="min-w-0 flex-1 break-all font-mono text-xs">
          {folder || 'Resource root'}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={directoryRead.isFetching}
          onClick={() => {
            setFile(null);
            openFolder(folder);
            if (pages.length === 1) void directoryRead.refetch();
          }}
        >
          Refresh directory
        </Button>
      </div>
      {directoryRead.isFetching ? (
        <p role="status">Reading directory…</p>
      ) : (
        <ReadError error={directoryRead.error} result={directoryRead.data} />
      )}
      {directory && (
        <>
          {directory.entries.length === 0 && (
            <p className="text-muted-foreground">No readable entries on this page.</p>
          )}
          <ul className="max-h-[32vh] overflow-auto">
            {directory.entries.map(entry => (
              <li key={entry.relativePath}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted aria-pressed:bg-muted"
                  aria-pressed={entry.type === 'file' ? file === entry.relativePath : undefined}
                  onClick={() =>
                    entry.type === 'directory'
                      ? openFolder(entry.relativePath)
                      : setFile(entry.relativePath)
                  }
                >
                  {entry.type === 'directory' ? (
                    <Folder size={15} className="shrink-0" />
                  ) : (
                    <FileText size={15} className="shrink-0" />
                  )}
                  <span className="min-w-0 break-all">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            {pages.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPages(pages.slice(0, -1));
                  setFile(null);
                }}
              >
                Previous page
              </Button>
            )}
            {directory.nextOffset !== null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPages([...pages, directory.nextOffset!]);
                  setFile(null);
                }}
              >
                Next page
              </Button>
            )}
          </div>
          {directoryRead.data?.truncated && <p>Directory scan limit reached.</p>}
        </>
      )}
      {file && (
        <section className="space-y-2 border-t pt-3" aria-label="File preview">
          <h4 className="break-all font-medium">{file}</h4>
          {fileRead.isFetching && <p role="status">Reading file…</p>}
          <ReadError error={fileRead.error} result={fileRead.data} />
          {content && (
            <>
              {fileRead.data?.truncated && <p>Showing a truncated preview.</p>}
              {content.content ? <Preview text={content.content} /> : <p>This file is empty.</p>}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function ResourceReadPanel({
  projectId,
  resource,
  source,
  mode,
  expanded,
  status
}: {
  projectId: string;
  resource: Resource;
  source: Source | null;
  mode: 'git' | 'files';
  expanded: boolean;
  status: ReturnType<typeof useRead>;
}) {
  const binding: Binding | null =
    source?.availability === 'ready'
      ? {
          sourceId: source.sourceId,
          sourceRevision: source.sourceRevision,
          executionTargetId: source.executionTargetId,
          resourceKey: resource.resourceKey
        }
      : null;
  if (mode === 'git' && status.data?.outcome === 'not_git_repository') {
    return <p className="text-muted-foreground">This source is a folder. Open it in Files.</p>;
  }
  if (!source) return null;
  if (source.availability === 'target_offline')
    return <p className="text-muted-foreground">The owning runner is offline.</p>;
  if (source.availability === 'unsupported')
    return <p className="text-muted-foreground">Update the native runner to read this checkout.</p>;
  if (!binding || !expanded) return null;
  return mode === 'git' ? (
    <GitChanges projectId={projectId} binding={binding} statusRead={status} />
  ) : (
    <Files projectId={projectId} binding={binding} />
  );
}

function ResourceCard({
  projectId,
  resource,
  mode,
  source,
  status,
  onSelect
}: {
  projectId: string;
  resource: Resource;
  mode: 'git' | 'files';
  source: Source | null;
  status: ReturnType<typeof useRead>;
  onSelect: (sourceId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = resource.label ?? resource.resourceKey;
  const isGit = !status.isError && status.data?.outcome === 'ok';
  return (
    <article className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 break-all font-medium">{label}</h3>
        {isGit && status.data?.branch && (
          <span className="break-all text-xs text-muted-foreground">{status.data.branch}</span>
        )}
        {source?.availability === 'ready' && (mode === 'files' || isGit) && (
          <Button
            size="sm"
            variant="outline"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Close' : mode === 'git' ? 'View changes' : 'Browse files'}
          </Button>
        )}
      </div>
      {(resource.sources.length > 1 || (resource.sources.length === 1 && !source)) && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Runner
          <select
            className="max-w-full rounded border bg-background px-2 py-1"
            value={source?.sourceId ?? ''}
            onChange={event => {
              onSelect(event.target.value);
              setExpanded(false);
            }}
          >
            <option value="">Choose a runner</option>
            {resource.sources.map(entry => (
              <option key={entry.sourceId} value={entry.sourceId}>
                {entry.targetLabel} ({entry.executionTargetId.slice(0, 8)})
                {entry.availability === 'target_offline' ? ' · Offline' : ''}
                {entry.availability === 'unsupported' ? ' · Update required' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {source && resource.sources.length === 1 && (
        <p className="text-xs text-muted-foreground">{source.targetLabel}</p>
      )}
      {resource.sources.length === 0 && (
        <p className="text-muted-foreground">No accessible checkout is linked to a runner.</p>
      )}
      {mode === 'git' && status.isFetching && !expanded && (
        <p role="status">Checking Git status…</p>
      )}
      {mode === 'git' && !expanded && status.data?.outcome !== 'not_git_repository' && (
        <ReadError error={status.error} result={status.data} />
      )}
      {mode === 'git' &&
        source?.availability === 'ready' &&
        (status.isError ||
          (status.data && !isGit && status.data.outcome !== 'not_git_repository')) && (
          <Button
            variant="outline"
            size="sm"
            disabled={status.isFetching}
            onClick={() => void status.refetch()}
          >
            Retry Git status
          </Button>
        )}
      <ResourceReadPanel
        key={JSON.stringify([source?.sourceId, source?.sourceRevision, source?.availability])}
        projectId={projectId}
        resource={resource}
        source={source}
        mode={mode}
        expanded={expanded}
        status={status}
      />
    </article>
  );
}

function ResourceList({
  projectId,
  mode,
  resources
}: {
  projectId: string;
  mode: 'git' | 'files';
  resources: ProjectResourceReadCatalog;
}) {
  const accountId = useContext(ResourceAccountContext);
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>({});
  const rows = resources.map(resource => {
    const selectedId = selectedIds[resource.id];
    const source =
      (selectedId
        ? resource.sources.find(entry => entry.sourceId === selectedId)
        : resource.sources.length === 1
          ? resource.sources[0]
          : undefined) ?? null;
    return { resource, source };
  });
  const statuses = useQueries({
    queries: rows.map(({ resource, source }) =>
      readOptions(
        projectId,
        mode === 'git' && source?.availability === 'ready'
          ? {
              sourceId: source.sourceId,
              sourceRevision: source.sourceRevision,
              executionTargetId: source.executionTargetId,
              resourceKey: resource.resourceKey,
              operation: 'git_status'
            }
          : null,
        accountId,
        resource.id
      )
    )
  });
  const confirmed = [];
  const unresolved = [];
  for (const [index, { resource, source }] of rows.entries()) {
    const status = statuses[index]!;
    if (
      mode === 'git' &&
      !resource.hasGitSource &&
      (resource.sources.length === 0 ||
        (resource.sources.length === 1 && status.data?.outcome === 'not_git_repository'))
    )
      continue;
    const card = (
      <ResourceCard
        key={resource.id}
        projectId={projectId}
        resource={resource}
        source={source}
        mode={mode}
        status={status}
        onSelect={id => setSelectedIds(previous => ({ ...previous, [resource.id]: id }))}
      />
    );
    if (mode === 'files' || (!status.isError && status.data?.outcome === 'ok'))
      confirmed.push(card);
    else unresolved.push(card);
  }
  return (
    <div className="max-h-[70vh] min-h-12 space-y-3 overflow-auto">
      {confirmed.length > 0 ? (
        confirmed
      ) : (
        <p className="text-muted-foreground">
          {mode === 'files'
            ? 'No resources are configured for this project.'
            : 'No Git worktrees are currently verified.'}
        </p>
      )}
      {unresolved.length > 0 && (
        <section className="space-y-2" aria-label="Resources awaiting Git verification">
          <h3 className="text-sm font-medium">Awaiting Git verification</h3>
          {unresolved}
        </section>
      )}
    </div>
  );
}

function subscribeToBrowserConnection(callback: () => void) {
  return onlineManager.subscribe(callback);
}

function browserIsOnline() {
  return onlineManager.isOnline();
}

function ResourceCatalog({ projectId, mode }: { projectId: string; mode: 'git' | 'files' }) {
  const accountId = useContext(ResourceAccountContext);
  const online = useSyncExternalStore(subscribeToBrowserConnection, browserIsOnline);
  const catalog = useQuery({
    queryKey: ['project-resource-read-catalog', accountId, projectId],
    queryFn: ({ signal }) => api.listProjectResourceReads(projectId, signal),
    gcTime: 0,
    staleTime: 0,
    enabled: online,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: 'always',
    retry: false
  });
  if (!online) return <p role="status">Reconnect to verify project access.</p>;
  if (catalog.isPending) return <p role="status">Loading project resources…</p>;
  if (catalog.isError) return <ReadError error={catalog.error} />;
  return <ResourceList projectId={projectId} mode={mode} resources={catalog.data} />;
}

export function ProjectResourceBrowser({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'git' | 'files'>('git');
  const accountId = useContext(ResourceAccountContext);

  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        setOpen(value);
        if (!value) setMode('git');
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Project Git and Files"
            title="Project Git and Files"
          />
        }
      >
        <GitBranch className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Project Git and Files</DialogTitle>
          <DialogDescription>
            Browse linked checkouts on their registered runners.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2" role="group" aria-label="Project resources view">
          <Button
            size="sm"
            variant={mode === 'git' ? 'default' : 'outline'}
            aria-pressed={mode === 'git'}
            onClick={() => setMode('git')}
          >
            Git
          </Button>
          <Button
            size="sm"
            variant={mode === 'files' ? 'default' : 'outline'}
            aria-pressed={mode === 'files'}
            onClick={() => setMode('files')}
          >
            Files
          </Button>
        </div>
        {open && (
          <ResourceCatalog
            key={JSON.stringify([accountId, projectId, mode])}
            mode={mode}
            projectId={projectId}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
