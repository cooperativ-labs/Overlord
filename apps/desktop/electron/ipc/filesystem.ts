/**
 * Filesystem IPC handlers — thin delegation layer on top of the unified
 * WorkspaceClient. Local mode uses LocalWorkspaceClient directly. Remote mode
 * resolves a tunnel (see services/remote-tunnel.ts) and uses
 * RemoteWorkspaceClient, so all operations go through a single persistent SSH
 * connection + HTTP helper rather than spawning a fresh ssh process per call.
 */

import { ipcMain } from 'electron';

import { LocalWorkspaceClient } from '../../../../lib/workspace/local';
import type {
  GitDiffOptions,
  ListFilesOptions,
  SshConnectionConfig,
  WorkspaceClient
} from '../../../../lib/workspace/types';
import { resolveRemoteWorkspaceClient, shutdownAllRemoteTunnels } from '../services/remote-tunnel';

type WorkspacePayload = {
  mode?: 'local' | 'remote';
  directory?: string;
  remoteDirectory?: string;
  ssh?: SshConnectionConfig;
  projectId?: string;
};

async function resolveClient(payload: WorkspacePayload | undefined): Promise<WorkspaceClient> {
  const mode = payload?.mode ?? (payload?.ssh ? 'remote' : 'local');
  if (mode === 'remote') {
    if (!payload?.ssh) throw new Error('SSH connection config is required.');
    if (!payload.remoteDirectory?.trim()) throw new Error('Remote working directory is required.');
    if (!payload.projectId) throw new Error('projectId is required for remote workspaces.');
    return resolveRemoteWorkspaceClient({
      projectId: payload.projectId,
      ssh: payload.ssh,
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
  ipcMain.handle('filesystem:directory-exists', async (_event, payload?: WorkspacePayload) => {
    try {
      const client = await resolveClient(payload);
      return await client.directoryExists();
    } catch {
      return false;
    }
  });

  ipcMain.handle(
    'filesystem:list-project-files',
    async (_event, payload?: WorkspacePayload & { options?: ListFilesOptions }) => {
      try {
        const client = await resolveClient(payload);
        return await client.listProjectFiles(payload?.options);
      } catch (error) {
        return failure(error, { files: [], linkedDirectory: null, truncated: false });
      }
    }
  );

  ipcMain.handle('filesystem:check-ssh-connection', async (_event, payload?: WorkspacePayload) => {
    try {
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

  ipcMain.handle('filesystem:get-git-status', async (_event, payload?: WorkspacePayload) => {
    try {
      const client = await resolveClient(payload);
      return await client.getGitStatus();
    } catch (error) {
      return failure(error, { branch: null, files: [], linkedDirectory: null, repoRoot: null });
    }
  });

  ipcMain.handle(
    'filesystem:get-git-diff',
    async (_event, payload?: WorkspacePayload & Partial<GitDiffOptions>) => {
      try {
        const relativePath = payload?.path?.trim();
        if (!relativePath) {
          return {
            diff: '',
            path: null,
            repoRoot: null,
            status: payload?.status ?? null,
            error: 'A file path is required.'
          };
        }
        const client = await resolveClient(payload);
        return await client.getGitDiff({
          path: relativePath,
          originalPath: payload?.originalPath,
          status: payload?.status
        });
      } catch (error) {
        return failure(error, {
          diff: '',
          path: payload?.path ?? null,
          repoRoot: null,
          status: payload?.status ?? null
        });
      }
    }
  );

  ipcMain.handle('filesystem:get-aggregate-diff', async (_event, payload?: WorkspacePayload) => {
    try {
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

  ipcMain.handle(
    'filesystem:git-commit-and-push',
    async (_event, payload?: WorkspacePayload & { message?: string }) => {
      try {
        const message = payload?.message?.trim();
        if (!message) {
          return {
            ok: false,
            branch: null,
            commitSha: null,
            pushed: false,
            error: 'Commit message cannot be empty.'
          };
        }
        const client = await resolveClient(payload);
        return await client.commitAndPush({ message });
      } catch (error) {
        return failure(error, { ok: false, branch: null, commitSha: null, pushed: false });
      }
    }
  );

  ipcMain.handle(
    'filesystem:read-file',
    async (_event, payload?: WorkspacePayload & { path?: string; maxBytes?: number }) => {
      try {
        const filePath = payload?.path?.trim();
        if (!filePath)
          return { content: '', path: '', truncated: false, error: 'path is required.' };
        const client = await resolveClient(payload);
        return await client.readFile({ path: filePath, maxBytes: payload?.maxBytes });
      } catch (error) {
        return failure(error, { content: '', path: payload?.path ?? '', truncated: false });
      }
    }
  );
}

export async function teardownFilesystemIpc(): Promise<void> {
  await shutdownAllRemoteTunnels();
}
