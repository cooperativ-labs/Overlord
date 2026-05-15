/**
 * Filesystem IPC handlers — delegation layer on top of WorkspaceClient (local only).
 */

import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import { z } from 'zod';

import { resolveLinkedDirectory } from '../../../../lib/filesystem/project-file-tree';
import { buildRepoOperationsProfile } from '../../../../lib/repo-profile/build-profile';
import {
  createCheckpoint,
  diffCheckpoint,
  listCheckpoints,
  pruneCheckpoints,
  restoreCheckpoint
} from '../../../../lib/snapshot/git-checkpoint';
import { LocalWorkspaceClient } from '../../../../lib/workspace/local';
import type {
  CreatePullRequestOptions,
  GitBranchOptions,
  GitDiffOptions,
  ListFilesOptions,
  WorkspaceClient
} from '../../../../lib/workspace/types';

const WorkspacePayloadSchema = z
  .object({
    directory: z.string().max(4096).optional()
  })
  .passthrough();

const ListFilesOptionsSchema = z
  .object({
    maxDepth: z.number().int().min(0).max(32).optional(),
    maxEntriesPerDirectory: z.number().int().min(1).max(5000).optional(),
    maxFiles: z.number().int().min(1).max(50_000).optional()
  })
  .passthrough();

const GitBranchOptionsSchema = z
  .object({
    name: z.string().min(1).max(255)
  })
  .passthrough();

const CreatePullRequestOptionsSchema = z
  .object({
    baseBranch: z.string().min(1).max(255).optional(),
    body: z.string().min(1).max(200_000),
    title: z.string().min(1).max(512)
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
  const directory = payload?.directory?.trim();
  if (!directory) throw new Error('Local working directory is required.');
  return new LocalWorkspaceClient(directory);
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

  ipcMain.handle('filesystem:create-checkpoint', async (_event, rawPayload?: unknown) => {
    try {
      const raw = (rawPayload ?? {}) as { directory?: unknown; objectiveId?: unknown };
      const directory = typeof raw.directory === 'string' ? raw.directory.trim() : '';
      const objectiveId = typeof raw.objectiveId === 'string' ? raw.objectiveId.trim() : '';
      if (!directory) return { ok: false, error: 'Local working directory is required.' };
      if (!objectiveId) return { ok: false, error: 'objectiveId is required.' };
      const result = await createCheckpoint({ workspacePath: directory, objectiveId });
      return { ok: true, ...result };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to create checkpoint.'
      };
    }
  });

  ipcMain.handle('filesystem:restore-checkpoint', async (_event, rawPayload?: unknown) => {
    try {
      const raw = (rawPayload ?? {}) as { directory?: unknown; objectiveId?: unknown };
      const directory = typeof raw.directory === 'string' ? raw.directory.trim() : '';
      const objectiveId = typeof raw.objectiveId === 'string' ? raw.objectiveId.trim() : '';
      if (!directory) return { ok: false, error: 'Local working directory is required.' };
      if (!objectiveId) return { ok: false, error: 'objectiveId is required.' };
      const result = await restoreCheckpoint({ workspacePath: directory, objectiveId });
      return { ok: true, ...result };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to restore checkpoint.'
      };
    }
  });

  ipcMain.handle('filesystem:diff-checkpoint', async (_event, rawPayload?: unknown) => {
    try {
      const raw = (rawPayload ?? {}) as {
        directory?: unknown;
        objectiveId?: unknown;
        gitCommitId?: unknown;
      };
      const directory = typeof raw.directory === 'string' ? raw.directory.trim() : '';
      const objectiveId = typeof raw.objectiveId === 'string' ? raw.objectiveId.trim() : '';
      const gitCommitId = typeof raw.gitCommitId === 'string' ? raw.gitCommitId.trim() : '';
      if (!directory) return { ok: false, error: 'Local working directory is required.' };
      if (!objectiveId && !gitCommitId) {
        return { ok: false, error: 'objectiveId or gitCommitId is required.' };
      }
      const result = await diffCheckpoint({
        workspacePath: directory,
        objectiveId: objectiveId || undefined,
        gitCommitId: gitCommitId || undefined
      });
      return { ok: true, ...result };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to diff checkpoint.'
      };
    }
  });

  ipcMain.handle('filesystem:prune-checkpoints', async (_event, rawPayload?: unknown) => {
    try {
      const raw = (rawPayload ?? {}) as {
        directory?: unknown;
        keepObjectiveIds?: unknown;
        objectiveIds?: unknown;
      };
      const directory = typeof raw.directory === 'string' ? raw.directory.trim() : '';
      if (!directory) return { ok: false, error: 'Local working directory is required.' };

      let objectiveIds = Array.isArray(raw.objectiveIds)
        ? raw.objectiveIds.filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0
          )
        : null;

      if (!objectiveIds) {
        const keepObjectiveIds = new Set(
          Array.isArray(raw.keepObjectiveIds)
            ? raw.keepObjectiveIds.filter(
                (id): id is string => typeof id === 'string' && id.trim().length > 0
              )
            : []
        );
        const checkpoints = await listCheckpoints({ workspacePath: directory });
        objectiveIds = checkpoints
          .map(checkpoint => checkpoint.objectiveId)
          .filter(objectiveId => !keepObjectiveIds.has(objectiveId));
      }

      const result = await pruneCheckpoints({ workspacePath: directory, objectiveIds });
      return { ok: true, ...result };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to prune checkpoints.'
      };
    }
  });

  ipcMain.handle('filesystem:get-git-branches', async (_event, rawPayload?: unknown) => {
    try {
      const payload = safeParseWorkspace(rawPayload);
      const client = await resolveClient(payload);
      return await client.getGitBranches();
    } catch (error) {
      return failure(error, {
        branches: [],
        currentBranch: null,
        defaultBranch: null,
        repoRoot: null
      });
    }
  });

  ipcMain.handle('filesystem:git-checkout-branch', async (_event, rawPayload?: unknown) => {
    try {
      const payload = safeParseWorkspace(rawPayload);
      const rawOptions = (rawPayload as { options?: unknown } | undefined)?.options;
      const options = GitBranchOptionsSchema.parse(rawOptions) as GitBranchOptions;
      const client = await resolveClient(payload);
      return await client.checkoutBranch(options);
    } catch (error) {
      return failure(error, { ok: false, branch: null });
    }
  });

  ipcMain.handle('filesystem:git-create-branch', async (_event, rawPayload?: unknown) => {
    try {
      const payload = safeParseWorkspace(rawPayload);
      const rawOptions = (rawPayload as { options?: unknown } | undefined)?.options;
      const options = GitBranchOptionsSchema.parse(rawOptions) as GitBranchOptions;
      const client = await resolveClient(payload);
      return await client.createBranch(options);
    } catch (error) {
      return failure(error, { ok: false, branch: null });
    }
  });

  ipcMain.handle('filesystem:git-pull', async (_event, rawPayload?: unknown) => {
    try {
      const payload = safeParseWorkspace(rawPayload);
      const client = await resolveClient(payload);
      return await client.pullBranch();
    } catch (error) {
      return failure(error, { ok: false, branch: null, output: '' });
    }
  });

  ipcMain.handle('filesystem:git-push', async (_event, rawPayload?: unknown) => {
    try {
      const payload = safeParseWorkspace(rawPayload);
      const client = await resolveClient(payload);
      return await client.pushBranch();
    } catch (error) {
      return failure(error, { ok: false, branch: null, pushed: false, output: '' });
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

  ipcMain.handle('filesystem:git-create-pull-request', async (_event, rawPayload?: unknown) => {
    try {
      const payload = safeParseWorkspace(rawPayload);
      const rawOptions = (rawPayload as { options?: unknown } | undefined)?.options;
      const options = CreatePullRequestOptionsSchema.parse(rawOptions) as CreatePullRequestOptions;
      const client = await resolveClient(payload);
      return await client.createPullRequest(options);
    } catch (error) {
      return failure(error, { ok: false, branch: null, number: null, url: null });
    }
  });

  ipcMain.handle('filesystem:rebuild-operations-profile', async (_event, rawPayload?: unknown) => {
    const parsed = z
      .object({
        directory: z.string().min(1).max(4096),
        currentFingerprint: z.string().max(512).nullable().optional()
      })
      .safeParse(rawPayload);
    if (!parsed.success) {
      return { ok: false, error: 'Invalid payload.' };
    }
    const { directory, currentFingerprint } = parsed.data;

    const root = resolveLinkedDirectory(directory);
    if (!root) {
      return { ok: false, error: 'Could not resolve working directory path.' };
    }

    try {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) {
        return { ok: false, error: 'Linked working directory is missing or not a directory.' };
      }
    } catch (err) {
      const isEnoent = err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
      return {
        ok: false,
        error: isEnoent
          ? 'Linked working directory does not exist.'
          : err instanceof Error
            ? err.message
            : 'Failed to access working directory.'
      };
    }

    try {
      const { profile, fingerprint } = await buildRepoOperationsProfile(root);
      return {
        ok: true,
        rebuilt: fingerprint !== (currentFingerprint ?? null),
        fingerprint,
        profile
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to build operations profile.'
      };
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
  // No remote tunnels to close (local workspace only).
}
