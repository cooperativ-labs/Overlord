/**
 * Filesystem IPC handlers — thin delegation layer on top of the unified
 * WorkspaceClient. Local mode uses LocalWorkspaceClient directly. Remote mode
 * resolves a tunnel (see services/remote-tunnel.ts) and uses
 * RemoteWorkspaceClient, so all operations go through a single persistent SSH
 * connection + HTTP helper rather than spawning a fresh ssh process per call.
 */

import { ipcMain } from 'electron';
import { z } from 'zod';

import { LocalWorkspaceClient } from '../../../../lib/workspace/local';
import type {
  GitDiffOptions,
  ListFilesOptions,
  SshConnectionConfig,
  WorkspaceClient
} from '../../../../lib/workspace/types';
import { resolveRemoteWorkspaceClient, shutdownAllRemoteTunnels } from '../services/remote-tunnel';

const SshConfigSchema = z
  .object({
    host: z.string().min(1).max(256),
    user: z.string().min(1).max(128).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    identityFile: z.string().max(4096).optional(),
    sshCommand: z.string().max(4096).optional()
  })
  .passthrough();

const WorkspacePayloadSchema = z
  .object({
    mode: z.enum(['local', 'remote']).optional(),
    directory: z.string().max(4096).optional(),
    remoteDirectory: z.string().max(4096).optional(),
    ssh: SshConfigSchema.optional(),
    projectId: z.string().max(256).optional()
  })
  .passthrough();

const ListFilesOptionsSchema = z
  .object({
    maxDepth: z.number().int().min(0).max(32).optional(),
    maxEntriesPerDirectory: z.number().int().min(1).max(5000).optional(),
    maxFiles: z.number().int().min(1).max(50_000).optional()
  })
  .passthrough();

type WorkspacePayload = z.infer<typeof WorkspacePayloadSchema>;

function safeParseWorkspace(payload: unknown): WorkspacePayload | undefined {
  if (payload === undefined || payload === null) return undefined;
  const result = WorkspacePayloadSchema.safeParse(payload);
  if (!result.success) throw new Error('Invalid workspace payload.');
  return result.data;
}

async function resolveClient(payload: WorkspacePayload | undefined): Promise<WorkspaceClient> {
  const mode = payload?.mode ?? (payload?.ssh ? 'remote' : 'local');
  if (mode === 'remote') {
    if (!payload?.ssh) throw new Error('SSH connection config is required.');
    if (!payload.remoteDirectory?.trim()) throw new Error('Remote working directory is required.');
    if (!payload.projectId) throw new Error('projectId is required for remote workspaces.');
    return resolveRemoteWorkspaceClient({
      projectId: payload.projectId,
      ssh: payload.ssh as SshConnectionConfig,
      remoteWorkingDirectory: payload.remoteDirectory
    });
  }
  if (!payload?.directory?.trim()) throw new Error('Local working directory is required.');
  return new LocalWorkspaceClient(payload.directory);
}

function failure<T extends object>(error: unknown, base: T): T & { error: string } {
  return {
    ...base,
    error: error instanceof Error ? error.message : 'Workspace operation failed.'
  };
}

export function registerFilesystemIpc(): void {
  ipcMain.handle('filesystem:directory-exists', async (_event, rawPayload?: unknown) => {
    try {
      const payload = safeParseWorkspace(rawPayload);
      const client = await resolveClient(payload);
      return await client.directoryExists();
    } catch {
      return false;
    }
  });

  ipcMain.handle('filesystem:list-project-files', async (_event, rawPayload?: unknown) => {
    try {
      const payload = safeParseWorkspace(rawPayload);
      const rawOptions = (rawPayload as { options?: unknown } | undefined)?.options;
      const options = rawOptions
        ? (ListFilesOptionsSchema.parse(rawOptions) as ListFilesOptions)
        : undefined;
      const client = await resolveClient(payload);
      return await client.listProjectFiles(options);
    } catch (error) {
      return failure(error, { files: [], linkedDirectory: null, truncated: false });
    }
  });

  ipcMain.handle('filesystem:check-ssh-connection', async (_event, rawPayload?: unknown) => {
    try {
      const payload = safeParseWorkspace(rawPayload);
      if (!payload?.ssh) return { ok: false, error: 'SSH config is required.' };
      const client = await resolveClient({
        ...payload,
        mode: 'remote',
        remoteDirectory: payload.remoteDirectory ?? '/'
      });
      return await client.checkHealth();
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'SSH connection failed.'
      };
    }
  });

  ipcMain.handle('filesystem:get-git-status', async (_event, rawPayload?: unknown) => {
    try {
      const payload = safeParseWorkspace(rawPayload);
      const client = await resolveClient(payload);
      return await client.getGitStatus();
    } catch (error) {
      return failure(error, { branch: null, files: [], linkedDirectory: null, repoRoot: null });
    }
  });

  ipcMain.handle('filesystem:get-git-diff', async (_event, rawPayload?: unknown) => {
    const raw = (rawPayload ?? {}) as Partial<GitDiffOptions>;
    try {
      const payload = safeParseWorkspace(rawPayload);
      const relativePath = typeof raw.path === 'string' ? raw.path.trim() : '';
      if (!relativePath) {
        return {
          diff: '',
          path: null,
          repoRoot: null,
          status: raw.status ?? null,
          error: 'A file path is required.'
        };
      }
      const client = await resolveClient(payload);
      return await client.getGitDiff({
        path: relativePath,
        originalPath: typeof raw.originalPath === 'string' ? raw.originalPath : undefined,
        status: typeof raw.status === 'string' ? raw.status : undefined
      });
    } catch (error) {
      return failure(error, {
        diff: '',
        path: raw.path ?? null,
        repoRoot: null,
        status: raw.status ?? null
      });
    }
  });

  ipcMain.handle('filesystem:get-aggregate-diff', async (_event, rawPayload?: unknown) => {
    try {
      const payload = safeParseWorkspace(rawPayload);
      const client = await resolveClient(payload);
      return await client.getAggregateDiff();
    } catch (error) {
      return failure(error, {
        branch: null,
        diff: '',
        filesChanged: 0,
        repoRoot: null,
        status: ''
      });
    }
  });

  ipcMain.handle('filesystem:git-commit-and-push', async (_event, rawPayload?: unknown) => {
    try {
      const payload = safeParseWorkspace(rawPayload);
      const messageRaw = (rawPayload as { message?: unknown } | undefined)?.message;
      const message = typeof messageRaw === 'string' ? messageRaw.trim() : '';
      if (!message) {
        return {
          ok: false,
          branch: null,
          commitSha: null,
          pushed: false,
          error: 'Commit message cannot be empty.'
        };
      }
      if (message.length > 20_000) {
        return {
          ok: false,
          branch: null,
          commitSha: null,
          pushed: false,
          error: 'Commit message exceeds 20000 characters.'
        };
      }
      const client = await resolveClient(payload);
      return await client.commitAndPush({ message });
    } catch (error) {
      return failure(error, { ok: false, branch: null, commitSha: null, pushed: false });
    }
  });

  ipcMain.handle('filesystem:read-file', async (_event, rawPayload?: unknown) => {
    const raw = (rawPayload ?? {}) as { path?: unknown; maxBytes?: unknown };
    const providedPath = typeof raw.path === 'string' ? raw.path : '';
    try {
      const payload = safeParseWorkspace(rawPayload);
      const filePath = providedPath.trim();
      if (!filePath) return { content: '', path: '', truncated: false, error: 'path is required.' };
      const maxBytes =
        typeof raw.maxBytes === 'number' && Number.isFinite(raw.maxBytes) && raw.maxBytes > 0
          ? Math.min(raw.maxBytes, 64 * 1024 * 1024)
          : undefined;
      const client = await resolveClient(payload);
      return await client.readFile({ path: filePath, maxBytes });
    } catch (error) {
      return failure(error, { content: '', path: providedPath, truncated: false });
    }
  });
}

export async function teardownFilesystemIpc(): Promise<void> {
  await shutdownAllRemoteTunnels();
}
