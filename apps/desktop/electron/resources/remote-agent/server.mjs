#!/usr/bin/env node

// apps/remote-agent/src/server.ts
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

// lib/workspace/local.ts
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// lib/workspace/git-parse.ts
function toPosixPath(value) {
  return value.split("\\").join("/");
}
function normalizeGitStatus(code) {
  if (code === "??") return "untracked";
  if (code.includes("R")) return "renamed";
  if (code.includes("C")) return "copied";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  if (code.includes("T")) return "typechange";
  return "modified";
}
function parseGitStatus(stdout) {
  const entries = stdout.split("\0").filter(Boolean);
  const files = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    const x = entry[0] ?? " ";
    const y = entry[1] ?? " ";
    const pathValue = entry.slice(3);
    const isRenameOrCopy = x === "R" || x === "C" || y === "R" || y === "C";
    const originalPath = isRenameOrCopy ? entries[index + 1] ?? null : null;
    if (isRenameOrCopy) index += 1;
    if (!pathValue) continue;
    files.push({
      originalPath: originalPath ? toPosixPath(originalPath) : null,
      path: toPosixPath(pathValue),
      stagedStatus: x,
      status: normalizeGitStatus(`${x}${y}`),
      unstagedStatus: y
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
function parseRenameTarget(value) {
  const braceMatch = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(value);
  if (braceMatch) {
    const [, prefix, originalSegment, nextSegment, suffix] = braceMatch;
    return {
      originalPath: `${prefix}${originalSegment}${suffix}`,
      path: `${prefix}${nextSegment}${suffix}`
    };
  }
  const separator = " => ";
  const separatorIndex = value.indexOf(separator);
  if (separatorIndex === -1) return null;
  return {
    originalPath: value.slice(0, separatorIndex),
    path: value.slice(separatorIndex + separator.length)
  };
}
function parseNumStat(stdout) {
  const stats = /* @__PURE__ */ new Map();
  const lines = stdout.split("\n").map((line) => line.trimEnd()).filter(Boolean);
  for (const line of lines) {
    const [addedRaw, removedRaw, ...pathParts] = line.split("	");
    const pathValue = pathParts.join("	").trim();
    if (!pathValue) continue;
    const parsedPath = parseRenameTarget(pathValue);
    const nextPath = parsedPath?.path ?? pathValue;
    stats.set(toPosixPath(nextPath), {
      linesAdded: addedRaw === "-" ? null : Number.parseInt(addedRaw ?? "", 10),
      linesRemoved: removedRaw === "-" ? null : Number.parseInt(removedRaw ?? "", 10)
    });
  }
  return stats;
}
function countLines(value) {
  if (value.length === 0) return 0;
  return value.split("\n").length;
}

// lib/workspace/local.ts
var execFileAsync = promisify(execFile);
var DEFAULT_MAX_FILES = 2e3;
var DEFAULT_MAX_DEPTH = 8;
var DEFAULT_MAX_ENTRIES_PER_DIRECTORY = 5e3;
var DEFAULT_GIT_TIMEOUT_MS = 15e3;
var DEFAULT_GH_TIMEOUT_MS = 3e4;
var DEFAULT_READ_MAX_BYTES = 512 * 1024;
var MAX_UNTRACKED_FILES_FOR_STATS = 50;
var MAX_UNTRACKED_FILE_BYTES_FOR_STATS = 512 * 1024;
var MAX_UNTRACKED_FILES_FOR_AGGREGATE_DIFF = 25;
var MAX_UNTRACKED_FILE_BYTES_FOR_AGGREGATE_DIFF = 512 * 1024;
var IGNORED_DIRECTORY_NAMES = /* @__PURE__ */ new Set([
  ".git",
  ".jj",
  ".next",
  "node_modules",
  "dist",
  "dist-electron",
  "release",
  ".turbo"
]);
async function runGit(cwd, args, options = {}) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: DEFAULT_GIT_TIMEOUT_MS
    });
    return { ok: true, output: stdout };
  } catch (error) {
    if (options.allowFailure) {
      const output = error instanceof Error && "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
      return { ok: false, output };
    }
    throw error;
  }
}
async function resolveRepo(directory) {
  const topLevel = await runGit(directory, ["rev-parse", "--show-toplevel"]);
  const repoRoot = topLevel.output.trim();
  if (!repoRoot) throw new Error("Directory is not inside a Git repository.");
  const branch = await runGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    allowFailure: true
  });
  return {
    branch: branch.ok ? branch.output.trim() || null : null,
    repoRoot
  };
}
async function runJj(cwd, args, options = {}) {
  try {
    const { stdout } = await execFileAsync("jj", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: DEFAULT_GIT_TIMEOUT_MS
    });
    return { ok: true, output: stdout };
  } catch (error) {
    if (options.allowFailure) {
      const output = error instanceof Error && "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
      return { ok: false, output };
    }
    throw error;
  }
}
async function resolveJjRepo(directory) {
  const root = await runJj(directory, ["--repository", directory, "root"]);
  const repoRoot = root.output.trim();
  if (!repoRoot) throw new Error("Directory is not inside a JJ repository.");
  return { repoRoot };
}
async function isJjWorkspace(directory) {
  const dotJj = await fs.stat(path.join(directory, ".jj")).catch(() => null);
  if (dotJj) return true;
  const root = await runJj(directory, ["--repository", directory, "root"], { allowFailure: true });
  return root.ok && root.output.trim().length > 0;
}
function parseJjStatus(output) {
  return output.split("\n").map((line) => line.trimEnd()).filter(Boolean).filter((line) => /^[A-Z?] /.test(line)).map((line) => {
    const code = line.slice(0, 1);
    const filePath = line.slice(2).trim();
    const status = code === "A" || code === "?" ? "untracked" : code === "D" ? "deleted" : code === "R" ? "renamed" : "modified";
    return {
      linesAdded: null,
      linesRemoved: null,
      originalPath: null,
      path: toPosixPath(filePath),
      stagedStatus: " ",
      status,
      unstagedStatus: code
    };
  });
}
function normalizeGitOutput(output) {
  return output.trim();
}
async function resolveDefaultBranch(repoRoot) {
  const symbolic = await runGit(
    repoRoot,
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    {
      allowFailure: true
    }
  );
  const ref = symbolic.ok ? symbolic.output.trim() : "";
  if (ref.startsWith("origin/")) return ref.slice("origin/".length) || null;
  return null;
}
async function pushCurrentBranch(repoRoot, branch) {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["push"], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
      timeout: DEFAULT_GIT_TIMEOUT_MS * 4
    });
    return { output: `${stdout ?? ""}${stderr ?? ""}` };
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
    const stdout = error instanceof Error && "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
    const combined = `${stdout}${stderr}`.trim();
    if (/has no upstream branch/i.test(combined)) {
      const upstream = await execFileAsync("git", ["push", "--set-upstream", "origin", branch], {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
        timeout: DEFAULT_GIT_TIMEOUT_MS * 4
      });
      return { output: `${upstream.stdout ?? ""}${upstream.stderr ?? ""}` };
    }
    const msg = combined || (error instanceof Error ? error.message : "git push failed. Ensure an upstream is set.");
    throw new Error(msg, { cause: error });
  }
}
async function readUntrackedStats(repoRoot, relativePath) {
  try {
    const absolutePath = path.join(repoRoot, relativePath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_FILE_BYTES_FOR_STATS) {
      return null;
    }
    const content = await fs.readFile(absolutePath, "utf8");
    return { linesAdded: countLines(content), linesRemoved: 0 };
  } catch {
    return null;
  }
}
async function getGitFileStats(repoRoot, files) {
  const tracked = await runGit(
    repoRoot,
    ["-c", "core.quotepath=false", "diff", "--numstat", "--find-renames", "--find-copies", "HEAD"],
    { allowFailure: true }
  );
  const stats = parseNumStat(tracked.output);
  const untrackedFilesForStats = files.filter((file) => file.status === "untracked" && !stats.has(file.path)).slice(0, MAX_UNTRACKED_FILES_FOR_STATS);
  await Promise.all(
    untrackedFilesForStats.map(async (file) => {
      const untracked = await readUntrackedStats(repoRoot, file.path);
      if (untracked) stats.set(file.path, untracked);
    })
  );
  return stats;
}
var LocalWorkspaceClient = class {
  constructor(workingDirectory) {
    this.kind = "local";
    const trimmed = workingDirectory?.trim();
    if (!trimmed) throw new Error("workingDirectory is required.");
    this.workingDirectory = path.resolve(trimmed);
  }
  async checkHealth() {
    const stat = await fs.stat(this.workingDirectory).catch(() => null);
    if (!stat?.isDirectory()) {
      return { ok: false, error: "Working directory does not exist or is not a directory." };
    }
    return { ok: true };
  }
  async directoryExists() {
    const stat = await fs.stat(this.workingDirectory).catch(() => null);
    return Boolean(stat?.isDirectory());
  }
  async listProjectFiles(options) {
    const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
    const rootDirectory = this.workingDirectory;
    const repoRootResult = await runGit(rootDirectory, ["rev-parse", "--show-toplevel"], {
      allowFailure: true
    });
    const repoRoot = repoRootResult.output.trim();
    if (repoRootResult.ok && repoRoot) {
      const relativeRoot = path.relative(repoRoot, rootDirectory);
      const normalizedRelativeRoot = relativeRoot && relativeRoot !== "." ? toPosixPath(relativeRoot) : null;
      const args = ["-C", repoRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"];
      if (normalizedRelativeRoot) args.push("--", normalizedRelativeRoot);
      const result = await runGit(repoRoot, args, { allowFailure: true });
      if (result.ok) {
        let files2 = result.output.split("\0").map((entry) => entry.trim()).filter(Boolean).map((entry) => toPosixPath(path.relative(rootDirectory, path.join(repoRoot, entry)))).filter((entry) => entry.length > 0 && !entry.startsWith("../") && entry !== "..").sort((left, right) => left.localeCompare(right));
        const truncated2 = files2.length > maxFiles;
        if (truncated2) files2 = files2.slice(0, maxFiles);
        return { files: files2, linkedDirectory: rootDirectory, truncated: truncated2 };
      }
    }
    const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
    const maxEntriesPerDirectory = options?.maxEntriesPerDirectory ?? DEFAULT_MAX_ENTRIES_PER_DIRECTORY;
    const files = [];
    let truncated = false;
    const walk = async (current, depth) => {
      if (truncated || depth > maxDepth) return;
      let entries;
      try {
        const raw = await fs.readdir(current, { withFileTypes: true });
        entries = raw.map((e) => ({
          isDirectory: () => e.isDirectory(),
          isFile: () => e.isFile(),
          name: String(e.name)
        }));
      } catch {
        return;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name));
      if (entries.length > maxEntriesPerDirectory) {
        entries = entries.slice(0, maxEntriesPerDirectory);
        truncated = true;
      }
      for (const entry of entries) {
        if (truncated) return;
        const absolutePath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
          if (entry.name.startsWith(".")) continue;
          await walk(absolutePath, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        files.push(toPosixPath(path.relative(rootDirectory, absolutePath)));
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
      }
    };
    await walk(rootDirectory, 0);
    return { files, linkedDirectory: rootDirectory, truncated };
  }
  async readFile(options) {
    const maxBytes = options.maxBytes ?? DEFAULT_READ_MAX_BYTES;
    const relative = options.path.trim();
    if (!relative)
      return { content: "", path: options.path, truncated: false, error: "path is required." };
    const absolute = path.resolve(this.workingDirectory, relative);
    if (!absolute.startsWith(this.workingDirectory)) {
      return {
        content: "",
        path: options.path,
        truncated: false,
        error: "Path escapes workspace."
      };
    }
    try {
      const handle = await fs.open(absolute, "r");
      try {
        const stat = await handle.stat();
        const size = Number(stat.size);
        const readLength = Math.min(size, maxBytes);
        const buffer = Buffer.alloc(readLength);
        await handle.read(buffer, 0, readLength, 0);
        return {
          content: buffer.toString("utf8"),
          path: options.path,
          truncated: size > maxBytes
        };
      } finally {
        await handle.close();
      }
    } catch (error) {
      return {
        content: "",
        path: options.path,
        truncated: false,
        error: error instanceof Error ? error.message : "Failed to read file."
      };
    }
  }
  async getGitStatus() {
    try {
      if (await isJjWorkspace(this.workingDirectory)) {
        const { repoRoot: repoRoot2 } = await resolveJjRepo(this.workingDirectory);
        const statusResult2 = await runJj(repoRoot2, ["--repository", repoRoot2, "status"]);
        return {
          branch: null,
          files: parseJjStatus(statusResult2.output),
          linkedDirectory: this.workingDirectory,
          repoRoot: repoRoot2
        };
      }
      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      const statusResult = await runGit(repoRoot, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=normal"
      ]);
      const files = parseGitStatus(statusResult.output);
      const stats = await getGitFileStats(repoRoot, files);
      return {
        branch,
        files: files.map((file) => {
          const fileStats = stats.get(file.path);
          return {
            ...file,
            linesAdded: fileStats?.linesAdded ?? null,
            linesRemoved: fileStats?.linesRemoved ?? null
          };
        }),
        linkedDirectory: this.workingDirectory,
        repoRoot
      };
    } catch (error) {
      return {
        branch: null,
        files: [],
        linkedDirectory: this.workingDirectory,
        repoRoot: null,
        error: error instanceof Error ? error.message : "Failed to read Git status."
      };
    }
  }
  async getGitDiff(options) {
    const relativePath = options.path.trim();
    if (!relativePath) {
      return {
        diff: "",
        path: null,
        repoRoot: null,
        status: options.status ?? null,
        error: "A file path is required."
      };
    }
    try {
      if (await isJjWorkspace(this.workingDirectory)) {
        const { repoRoot: repoRoot2 } = await resolveJjRepo(this.workingDirectory);
        const normalizedPath2 = toPosixPath(relativePath);
        const result2 = await runJj(repoRoot2, [
          "--repository",
          repoRoot2,
          "diff",
          "--git",
          "--",
          normalizedPath2
        ]);
        return {
          diff: result2.output,
          path: relativePath,
          repoRoot: repoRoot2,
          status: options.status ?? null
        };
      }
      const { repoRoot } = await resolveRepo(this.workingDirectory);
      const normalizedPath = toPosixPath(relativePath);
      const normalizedOriginal = options.originalPath?.trim() ? toPosixPath(options.originalPath.trim()) : null;
      if (options.status === "untracked") {
        const fullPath = path.join(repoRoot, normalizedPath);
        const result2 = await runGit(
          repoRoot,
          ["diff", "--no-index", "--no-ext-diff", "--unified=3", "--", "/dev/null", fullPath],
          { allowFailure: true }
        );
        return {
          diff: result2.output,
          path: relativePath,
          repoRoot,
          status: options.status ?? null
        };
      }
      if ((options.status === "renamed" || options.status === "copied") && normalizedOriginal) {
        const result2 = await runGit(repoRoot, [
          "diff",
          "--no-ext-diff",
          "--unified=3",
          "--find-renames",
          "HEAD",
          "--",
          normalizedOriginal,
          normalizedPath
        ]);
        return {
          diff: result2.output,
          path: relativePath,
          repoRoot,
          status: options.status ?? null
        };
      }
      const result = await runGit(repoRoot, [
        "diff",
        "--no-ext-diff",
        "--unified=3",
        "HEAD",
        "--",
        normalizedPath
      ]);
      return { diff: result.output, path: relativePath, repoRoot, status: options.status ?? null };
    } catch (error) {
      return {
        diff: "",
        path: relativePath,
        repoRoot: null,
        status: options.status ?? null,
        error: error instanceof Error ? error.message : "Failed to read Git diff."
      };
    }
  }
  async getAggregateDiff() {
    try {
      if (await isJjWorkspace(this.workingDirectory)) {
        const { repoRoot: repoRoot2 } = await resolveJjRepo(this.workingDirectory);
        const [statusResult2, diffResult] = await Promise.all([
          runJj(repoRoot2, ["--repository", repoRoot2, "status"], { allowFailure: true }),
          runJj(repoRoot2, ["--repository", repoRoot2, "diff", "--git"], { allowFailure: true })
        ]);
        const files = parseJjStatus(statusResult2.output);
        return {
          branch: null,
          diff: diffResult.output,
          filesChanged: files.length,
          repoRoot: repoRoot2,
          status: statusResult2.output
        };
      }
      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      const statusResult = await runGit(repoRoot, ["status", "--short"]);
      const trackedDiff = await runGit(
        repoRoot,
        ["-c", "core.quotepath=false", "diff", "HEAD", "--no-color", "--unified=2"],
        { allowFailure: true }
      );
      const untrackedResult = await runGit(
        repoRoot,
        ["ls-files", "--others", "--exclude-standard", "-z"],
        { allowFailure: true }
      );
      const untrackedFiles = untrackedResult.output.split("\0").filter(Boolean);
      let untrackedDiff = "";
      for (const relPath of untrackedFiles.slice(0, MAX_UNTRACKED_FILES_FOR_AGGREGATE_DIFF)) {
        const fullPath = path.join(repoRoot, relPath);
        const stat = await fs.stat(fullPath).catch(() => null);
        if (!stat?.isFile()) continue;
        if (stat.size > MAX_UNTRACKED_FILE_BYTES_FOR_AGGREGATE_DIFF) {
          untrackedDiff += `diff --git a/${relPath} b/${relPath}
`;
          untrackedDiff += `new file mode 100644
`;
          untrackedDiff += `--- /dev/null
`;
          untrackedDiff += `+++ b/${relPath}
`;
          untrackedDiff += `@@ -0,0 +1 @@
`;
          untrackedDiff += `+[untracked file omitted: ${stat.size} bytes exceeds ${MAX_UNTRACKED_FILE_BYTES_FOR_AGGREGATE_DIFF} byte preview limit]

`;
          continue;
        }
        const piece = await runGit(
          repoRoot,
          ["diff", "--no-index", "--no-ext-diff", "--unified=2", "--", "/dev/null", fullPath],
          { allowFailure: true }
        );
        if (piece.output) untrackedDiff += piece.output + "\n";
      }
      const filesChanged = (statusResult.output.match(/\n/g)?.length ?? 0) + (statusResult.output.trim() ? 1 : 0);
      return {
        branch,
        diff: trackedDiff.output + (untrackedDiff ? `
${untrackedDiff}` : ""),
        filesChanged,
        repoRoot,
        status: statusResult.output
      };
    } catch (error) {
      return {
        branch: null,
        diff: "",
        filesChanged: 0,
        repoRoot: null,
        status: "",
        error: error instanceof Error ? error.message : "Failed to read aggregate Git diff."
      };
    }
  }
  async getGitBranches() {
    try {
      if (await isJjWorkspace(this.workingDirectory)) {
        const { repoRoot: repoRoot2 } = await resolveJjRepo(this.workingDirectory);
        return {
          branches: [],
          currentBranch: null,
          defaultBranch: null,
          repoRoot: repoRoot2
        };
      }
      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      const defaultBranch = await resolveDefaultBranch(repoRoot);
      const refs = await runGit(repoRoot, [
        "for-each-ref",
        "--format=%(refname:short)	%(HEAD)	%(upstream:short)",
        "refs/heads"
      ]);
      const branches = refs.output.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
        const [name, headMarker, upstreamRaw] = line.split("	");
        return {
          current: headMarker === "*",
          name,
          upstream: upstreamRaw?.trim() ? upstreamRaw.trim() : null
        };
      }).sort((left, right) => {
        if (left.current && !right.current) return -1;
        if (!left.current && right.current) return 1;
        return left.name.localeCompare(right.name);
      });
      return {
        branches,
        currentBranch: branch,
        defaultBranch,
        repoRoot
      };
    } catch (error) {
      return {
        branches: [],
        currentBranch: null,
        defaultBranch: null,
        repoRoot: null,
        error: error instanceof Error ? error.message : "Failed to read Git branches."
      };
    }
  }
  async checkoutBranch(options) {
    const branchName = options.name.trim();
    if (!branchName) return { ok: false, branch: null, error: "Branch name is required." };
    try {
      const { repoRoot } = await resolveRepo(this.workingDirectory);
      await runGit(repoRoot, ["checkout", branchName]);
      const next = await resolveRepo(repoRoot);
      return { ok: true, branch: next.branch };
    } catch (error) {
      return {
        ok: false,
        branch: null,
        error: error instanceof Error ? error.message : "Failed to switch branches."
      };
    }
  }
  async createBranch(options) {
    const branchName = options.name.trim();
    if (!branchName) return { ok: false, branch: null, error: "Branch name is required." };
    try {
      const { repoRoot } = await resolveRepo(this.workingDirectory);
      await runGit(repoRoot, ["checkout", "-b", branchName]);
      const next = await resolveRepo(repoRoot);
      return { ok: true, branch: next.branch };
    } catch (error) {
      return {
        ok: false,
        branch: null,
        error: error instanceof Error ? error.message : "Failed to create branch."
      };
    }
  }
  async pullBranch() {
    try {
      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      if (!branch) throw new Error("Cannot pull from a detached HEAD. Check out a branch first.");
      const result = await execFileAsync("git", ["pull", "--ff-only"], {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
        timeout: DEFAULT_GIT_TIMEOUT_MS * 4
      });
      return {
        ok: true,
        branch,
        output: normalizeGitOutput(`${result.stdout ?? ""}${result.stderr ?? ""}`)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to pull the current branch.";
      return {
        ok: false,
        branch: null,
        output: "",
        error: message
      };
    }
  }
  async pushBranch() {
    try {
      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      if (!branch) throw new Error("Cannot push from a detached HEAD. Check out a branch first.");
      const result = await pushCurrentBranch(repoRoot, branch);
      return {
        ok: true,
        branch,
        pushed: true,
        output: normalizeGitOutput(result.output)
      };
    } catch (error) {
      return {
        ok: false,
        branch: null,
        pushed: false,
        output: "",
        error: error instanceof Error ? error.message : "Failed to push the current branch."
      };
    }
  }
  async commitAndPush(options) {
    const message = options.message.trim();
    if (!message) {
      return {
        ok: false,
        branch: null,
        commitSha: null,
        pushed: false,
        error: "Commit message cannot be empty."
      };
    }
    try {
      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      if (!branch) throw new Error("Cannot push from a detached HEAD. Check out a branch first.");
      await runGit(repoRoot, ["add", "-A"]);
      const staged = await runGit(repoRoot, ["diff", "--cached", "--name-only"]);
      if (!staged.output.trim()) throw new Error("No staged changes to commit.");
      await runGit(repoRoot, ["commit", "-m", message]);
      const shaResult = await runGit(repoRoot, ["rev-parse", "HEAD"], { allowFailure: true });
      const commitSha = shaResult.ok ? shaResult.output.trim() || null : null;
      await pushCurrentBranch(repoRoot, branch);
      return { ok: true, branch, commitSha, pushed: true };
    } catch (error) {
      return {
        ok: false,
        branch: null,
        commitSha: null,
        pushed: false,
        error: error instanceof Error ? error.message : "Failed to commit and push."
      };
    }
  }
  async createPullRequest(options) {
    const title = options.title.trim();
    const body = options.body.trim();
    if (!title)
      return { ok: false, branch: null, number: null, url: null, error: "PR title is required." };
    if (!body)
      return { ok: false, branch: null, number: null, url: null, error: "PR body is required." };
    try {
      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      if (!branch) {
        throw new Error("Cannot create a PR from a detached HEAD. Check out a branch first.");
      }
      const defaultBranch = await resolveDefaultBranch(repoRoot);
      const baseBranch = options.baseBranch?.trim() || defaultBranch || void 0;
      if (baseBranch && branch === baseBranch) {
        throw new Error("Switch to a feature branch before creating a pull request.");
      }
      const args = ["pr", "create", "--head", branch, "--title", title, "--body", body];
      if (baseBranch) args.push("--base", baseBranch);
      const result = await execFileAsync("gh", args, {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
        timeout: DEFAULT_GH_TIMEOUT_MS
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
      const url = output.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? null;
      const number = url ? Number(url.match(/\/pull\/(\d+)(?:\/|$)/)?.[1] ?? NaN) : NaN;
      return {
        ok: true,
        branch,
        number: Number.isFinite(number) ? number : null,
        url
      };
    } catch (error) {
      return {
        ok: false,
        branch: null,
        number: null,
        url: null,
        error: error instanceof Error ? error.message : "Failed to create a GitHub pull request."
      };
    }
  }
};

// apps/remote-agent/src/server.ts
var VERSION = "0.1.0";
var DEFAULT_PORT = Number.parseInt(process.env.OVERLORD_REMOTE_PORT ?? "0", 10);
var DEFAULT_HOST = "127.0.0.1";
var TOKEN_PATH = process.env.OVERLORD_REMOTE_TOKEN_PATH ?? join(homedir(), ".overlord", "remote", "token");
async function loadAuthToken() {
  const raw = await readFile(TOKEN_PATH, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`Auth token at ${TOKEN_PATH} is empty.`);
  return trimmed;
}
function buildHandlers() {
  const workspaceFor = (body) => {
    const dir = typeof body.workingDirectory === "string" ? body.workingDirectory : "";
    if (!dir) throw new Error("workingDirectory is required.");
    return new LocalWorkspaceClient(dir);
  };
  return {
    "/directory-exists": async (body) => ({ exists: await workspaceFor(body).directoryExists() }),
    "/list-project-files": async (body) => workspaceFor(body).listProjectFiles(
      body.options ?? void 0
    ),
    "/read-file": async (body) => workspaceFor(body).readFile(body.options),
    "/git/status": async (body) => workspaceFor(body).getGitStatus(),
    "/git/diff": async (body) => workspaceFor(body).getGitDiff(body.options),
    "/git/aggregate-diff": async (body) => workspaceFor(body).getAggregateDiff(),
    "/git/commit-and-push": async (body) => workspaceFor(body).commitAndPush(body.options)
  };
}
function send(res, status, body) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain" : "application/json",
    "content-length": Buffer.byteLength(payload).toString()
  });
  res.end(payload);
}
async function readBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw new Error("Request body too large.");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}
var MAX_AUTH_FAILURES = 10;
var AUTH_FAIL_WINDOW_MS = 6e4;
function createAuthGuard(authToken) {
  const tokenBuf = Buffer.from(authToken, "utf8");
  const failures = /* @__PURE__ */ new Map();
  return {
    check(req) {
      const header = req.headers.authorization ?? "";
      if (!header.startsWith("Bearer ")) return false;
      const provided = Buffer.from(header.slice(7), "utf8");
      if (provided.length !== tokenBuf.length) return false;
      return timingSafeEqual(provided, tokenBuf);
    },
    recordSuccess(ip) {
      failures.delete(ip);
    },
    isBlocked(ip) {
      const entry = failures.get(ip);
      if (!entry) return false;
      if (Date.now() - entry.firstAt > AUTH_FAIL_WINDOW_MS) {
        failures.delete(ip);
        return false;
      }
      return entry.count >= MAX_AUTH_FAILURES;
    },
    recordFailure(ip) {
      const now = Date.now();
      const entry = failures.get(ip);
      if (!entry || now - entry.firstAt > AUTH_FAIL_WINDOW_MS) {
        failures.set(ip, { count: 1, firstAt: now });
      } else {
        entry.count += 1;
      }
    }
  };
}
function requestId() {
  return Math.random().toString(36).slice(2, 10);
}
function clientIp(req) {
  return req.socket.remoteAddress ?? "unknown";
}
async function main() {
  const authToken = await loadAuthToken();
  const handlers = buildHandlers();
  const guard = createAuthGuard(authToken);
  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const id = requestId();
    const ip = clientIp(req);
    if (guard.isBlocked(ip)) {
      process.stderr.write(`[${id}] ${ip} ${method} ${url} rate-limited
`);
      return send(res, 429, { error: "Too many failed attempts." });
    }
    if (url === "/health") {
      if (!guard.check(req)) {
        guard.recordFailure(ip);
        process.stderr.write(`[${id}] ${ip} GET /health unauthorized
`);
        return send(res, 401, { ok: false, error: "Unauthorized." });
      }
      guard.recordSuccess(ip);
      return send(res, 200, { ok: true, version: VERSION });
    }
    if (method !== "POST") return send(res, 405, { error: "Method not allowed." });
    if (!guard.check(req)) {
      guard.recordFailure(ip);
      process.stderr.write(`[${id}] ${ip} POST ${url} unauthorized
`);
      return send(res, 401, { error: "Unauthorized." });
    }
    guard.recordSuccess(ip);
    const handler = handlers[url];
    if (!handler) return send(res, 404, { error: "Not found." });
    let rawBody;
    try {
      rawBody = await readBody(req, 16 * 1024 * 1024);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Read error.";
      process.stderr.write(`[${id}] ${ip} POST ${url} body-error: ${message}
`);
      return send(res, 413, { error: "Request body too large." });
    }
    let body;
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[${id}] ${ip} POST ${url} invalid-json: ${detail}
`);
      return send(res, 400, { error: "Invalid JSON body." });
    }
    try {
      const result = await handler(body);
      return send(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error.";
      process.stderr.write(`[${id}] ${ip} POST ${url} handler-error: ${message}
`);
      return send(res, 500, { error: message });
    }
  });
  server.on("listening", () => {
    const address = server.address();
    if (address && typeof address === "object") {
      process.stdout.write(`OVERLORD_REMOTE_READY ${address.address}:${address.port}
`);
    }
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5e3).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  server.listen(DEFAULT_PORT, DEFAULT_HOST);
}
main().catch((error) => {
  process.stderr.write(
    `overlord-remote-agent failed to start: ${error instanceof Error ? error.message : String(error)}
`
  );
  process.exit(1);
});
