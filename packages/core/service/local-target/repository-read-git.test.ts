import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { collectWorktreeChanges } from './commit-message-diff-git.ts';
import { readCurrentDiffGit, withholdSensitiveDiffSections } from './current-diff-git.ts';
import { runInspectionGit } from './git-run.ts';
import { InProcessProvider } from './in-process-provider.ts';
import {
  isSensitiveRepositoryPath,
  normalizeRepositoryRelativePath,
  resolveContainedRepositoryPath
} from './repository-paths.ts';
import {
  readGitStatusGit,
  readRepositoryFileGit,
  searchRepositoryTextGit
} from './repository-read-git.ts';
import type { RepositoryReadTargetValue } from './types.ts';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com'
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV }).trim();
}

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function repo(): string {
  const dir = tempDir('ovld-repo-read-');
  git(dir, ['init', '-q', '-b', 'main']);
  writeFileSync(path.join(dir, 'a.txt'), 'alpha\nbeta\ngamma\n');
  writeFileSync(path.join(dir, '.gitignore'), 'ignored/\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

function ok<T>(value: RepositoryReadTargetValue<T> | { ok: false }): RepositoryReadTargetValue<T> {
  assert.ok(
    !('ok' in value && value.ok === false),
    `expected a value, got ${JSON.stringify(value)}`
  );
  return value as RepositoryReadTargetValue<T>;
}

/** A repository whose config tries to execute code on every common read path. */
function hostileRepo(): { dir: string; markers: string } {
  const dir = repo();
  const markers = tempDir('ovld-repo-markers-');
  const touch = (name: string) => `touch '${path.join(markers, name)}'`;
  writeFileSync(path.join(dir, '.gitattributes'), 'a.txt filter=evil diff=evil\n');
  git(dir, ['add', '.gitattributes']);
  git(dir, ['commit', '-q', '-m', 'attrs']);
  git(dir, ['config', 'filter.evil.clean', `sh -c "${touch('clean')}; cat"`]);
  git(dir, ['config', 'filter.evil.smudge', `sh -c "${touch('smudge')}; cat"`]);
  git(dir, ['config', 'filter.evil.process', `sh -c "${touch('process')}"`]);
  git(dir, ['config', 'diff.evil.textconv', `sh -c '${touch('textconv')}; cat "$0"'`]);
  git(dir, ['config', 'diff.external', `sh -c '${touch('extdiff')}'`]);
  const fsmonitor = path.join(markers, 'fsmonitor.sh');
  writeFileSync(fsmonitor, `#!/bin/sh\n${touch('fsmonitor')}\n`);
  chmodSync(fsmonitor, 0o755);
  git(dir, ['config', 'core.fsmonitor', fsmonitor]);
  const hooks = path.join(dir, '.git', 'hooks');
  for (const hook of ['post-checkout', 'post-index-change', 'reference-transaction']) {
    writeFileSync(path.join(hooks, hook), `#!/bin/sh\n${touch(hook)}\n`);
    chmodSync(path.join(hooks, hook), 0o755);
  }
  writeFileSync(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
  return { dir, markers };
}

const restorePath = process.env.PATH;
after(() => {
  process.env.PATH = restorePath;
});

describe('repository paths', () => {
  it('rejects absolute, escaping, NUL, and .git paths', () => {
    for (const bad of [
      '/etc/passwd',
      'C:\\x',
      '\\\\host\\share',
      '../x',
      'a/../../x',
      'a\0b',
      '.git/config',
      'sub/.GIT/HEAD'
    ]) {
      assert.equal(normalizeRepositoryRelativePath(bad).ok, false, bad);
    }
    assert.deepEqual(normalizeRepositoryRelativePath('./src//a.ts'), {
      ok: true,
      relativePath: 'src/a.ts'
    });
    assert.deepEqual(normalizeRepositoryRelativePath(''), { ok: true, relativePath: '' });
  });

  it('classifies credential and sensitive paths', () => {
    for (const sensitive of [
      '.env',
      'apps/web/.env.local',
      '.npmrc',
      'keys/id_rsa',
      'deploy/server.pem',
      'home/.ssh/config',
      '.aws/credentials',
      'credentials.prod.json',
      'infra/terraform.tfstate',
      '.overlord/tmp/sessions/x.json'
    ]) {
      assert.equal(isSensitiveRepositoryPath(sensitive, []), true, sensitive);
    }
    for (const fine of [
      '.env.example',
      '.env.local.example',
      'keys/id_rsa.pub',
      'src/env.ts',
      'README.md'
    ]) {
      assert.equal(isSensitiveRepositoryPath(fine, []), false, fine);
    }
    assert.equal(isSensitiveRepositoryPath('config/prod.yml', [/^config\/.*\.yml$/i]), true);
  });

  it('denies a symlink that leaves the resource but allows one inside it', () => {
    const dir = repo();
    const outside = tempDir('ovld-outside-');
    writeFileSync(path.join(outside, 'secret.txt'), 'nope');
    symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'escape.txt'));
    symlinkSync(outside, path.join(dir, 'escape-dir'));
    symlinkSync(path.join(dir, 'a.txt'), path.join(dir, 'inside.txt'));
    const escaped = resolveContainedRepositoryPath(dir, 'escape.txt');
    assert.equal(escaped.ok, false);
    if (!escaped.ok) assert.equal(escaped.outcome, 'denied');
    const viaDir = resolveContainedRepositoryPath(dir, 'escape-dir/secret.txt');
    assert.equal(viaDir.ok, false);
    assert.equal(resolveContainedRepositoryPath(dir, 'inside.txt').ok, true);
  });
});

describe('readRepositoryFileGit', () => {
  it('reads a bounded line range and reports totals', async () => {
    const dir = repo();
    const value = ok(
      await readRepositoryFileGit({
        resourceId: 'r',
        repoPath: dir,
        relativePath: 'a.txt',
        startLine: 2,
        endLine: 3
      })
    );
    assert.equal(value.outcome, 'ok');
    assert.equal(value.data?.content, 'beta\ngamma');
    assert.equal(value.data?.totalLines, 3);
    assert.equal(value.data?.startLine, 2);
    assert.equal(value.data?.endLine, 3);
    assert.equal(value.truncated, false);
    assert.match(value.head ?? '', /^[0-9a-f]{40}$/);
    assert.equal(value.branch, 'main');
  });

  it('truncates at a line boundary under maxBytes', async () => {
    const dir = repo();
    writeFileSync(
      path.join(dir, 'big.txt'),
      Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n')
    );
    const value = ok(
      await readRepositoryFileGit({
        resourceId: 'r',
        repoPath: dir,
        relativePath: 'big.txt',
        maxBytes: 100
      })
    );
    assert.equal(value.truncated, true);
    assert.ok(Buffer.byteLength(value.data?.content ?? '') <= 100);
    assert.equal(value.data?.content?.split('\n').at(-1), `line ${(value.data?.endLine ?? 0) - 1}`);
  });

  it('returns metadata only for binary, invalid UTF-8, and oversized files', async () => {
    const dir = repo();
    writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
    writeFileSync(path.join(dir, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    writeFileSync(path.join(dir, 'huge.txt'), Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
    for (const [file, outcome] of [
      ['bin.dat', 'binary'],
      ['latin1.txt', 'binary'],
      ['huge.txt', 'oversized']
    ] as const) {
      const value = ok(
        await readRepositoryFileGit({ resourceId: 'r', repoPath: dir, relativePath: file })
      );
      assert.equal(value.outcome, outcome, file);
      assert.equal(value.data?.content, null);
      assert.ok((value.data?.totalBytes ?? 0) > 0);
    }
  });

  it('denies traversal, symlink escape, git metadata, and secrets; reports missing files', async () => {
    const dir = repo();
    const outside = tempDir('ovld-outside-');
    writeFileSync(path.join(outside, 'x'), 'x');
    symlinkSync(path.join(outside, 'x'), path.join(dir, 'link'));
    writeFileSync(path.join(dir, '.env'), 'TOKEN=secret');
    for (const relativePath of ['../x', '/etc/hosts', 'link', '.git/config', '.env']) {
      const value = ok(
        await readRepositoryFileGit({ resourceId: 'r', repoPath: dir, relativePath })
      );
      assert.equal(value.outcome, 'denied', relativePath);
      assert.equal(value.data, null);
    }
    const missing = ok(
      await readRepositoryFileGit({ resourceId: 'r', repoPath: dir, relativePath: 'nope.txt' })
    );
    assert.equal(missing.outcome, 'not_found');
  });

  it('fails typed when the resource directory is gone', async () => {
    const result = await readRepositoryFileGit({
      resourceId: 'r',
      repoPath: path.join(tmpdir(), 'ovld-missing-xyz'),
      relativePath: 'a'
    });
    assert.equal('ok' in result && result.ok, false);
    if ('code' in result) assert.equal(result.code, 'RESOURCE_MISSING');
  });
});

describe('readGitStatusGit', () => {
  it('classifies staged, unstaged, untracked, renamed and conflicted paths', async () => {
    const dir = repo();
    writeFileSync(path.join(dir, 'b.txt'), 'b\n');
    git(dir, ['add', 'b.txt']);
    writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
    git(dir, ['mv', '.gitignore', 'gitignore-moved']);
    writeFileSync(path.join(dir, 'new file.txt'), 'n\n');
    const value = ok(await readGitStatusGit({ resourceId: 'r', repoPath: dir }));
    assert.equal(value.outcome, 'ok');
    assert.equal(value.data?.branch, 'main');
    assert.deepEqual(value.data?.staged.map(e => e.path).sort(), ['b.txt', 'gitignore-moved']);
    assert.equal(
      value.data?.staged.find(e => e.path === 'gitignore-moved')?.originalPath,
      '.gitignore'
    );
    assert.deepEqual(
      value.data?.unstaged.map(e => e.path),
      ['a.txt']
    );
    assert.ok(value.data?.untracked.includes('new file.txt'));

    const conflict = repo();
    git(conflict, ['checkout', '-q', '-b', 'other']);
    writeFileSync(path.join(conflict, 'a.txt'), 'other\n');
    git(conflict, ['commit', '-qam', 'other']);
    git(conflict, ['checkout', '-q', 'main']);
    writeFileSync(path.join(conflict, 'a.txt'), 'main\n');
    git(conflict, ['commit', '-qam', 'main']);
    try {
      git(conflict, ['merge', '-q', 'other']);
    } catch {
      // expected conflict
    }
    const conflicted = ok(await readGitStatusGit({ resourceId: 'r', repoPath: conflict }));
    assert.deepEqual(
      conflicted.data?.conflicted.map(e => e.path),
      ['a.txt']
    );
  });

  it('bounds each class and reports paths relative to a subdirectory resource', async () => {
    const dir = repo();
    mkdirSync(path.join(dir, 'pkg'));
    writeFileSync(path.join(dir, 'pkg', 'tracked.txt'), 't');
    git(dir, ['add', 'pkg']);
    git(dir, ['commit', '-qm', 'pkg']);
    for (let i = 0; i < 5; i += 1) writeFileSync(path.join(dir, 'pkg', `u${i}.txt`), 'x');
    const value = ok(
      await readGitStatusGit({
        resourceId: 'r',
        repoPath: path.join(dir, 'pkg'),
        maxEntriesPerClass: 3
      })
    );
    assert.equal(value.data?.untracked.length, 3);
    assert.equal(value.truncated, true);
    assert.ok(value.data?.untracked.every(p => /^u\d\.txt$/.test(p)));
  });

  it('is not a repository for a plain directory', async () => {
    const result = await readGitStatusGit({ resourceId: 'r', repoPath: tempDir('ovld-plain-') });
    assert.ok('code' in result && result.code === 'NOT_GIT_REPOSITORY');
  });
});

describe('readCurrentDiffGit', () => {
  it('reads unstaged, staged, and all scopes and limits to paths', async () => {
    const dir = repo();
    writeFileSync(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
    writeFileSync(path.join(dir, 'c.txt'), 'c\n');
    git(dir, ['add', 'c.txt']);
    const unstaged = ok(
      await readCurrentDiffGit({ resourceId: 'r', repoPath: dir, scope: 'unstaged' })
    );
    assert.deepEqual(unstaged.data?.files, ['a.txt']);
    const staged = ok(
      await readCurrentDiffGit({ resourceId: 'r', repoPath: dir, scope: 'staged' })
    );
    assert.deepEqual(staged.data?.files, ['c.txt']);
    const all = ok(await readCurrentDiffGit({ resourceId: 'r', repoPath: dir, scope: 'all' }));
    assert.deepEqual(all.data?.files.sort(), ['a.txt', 'c.txt']);
    const scoped = ok(
      await readCurrentDiffGit({
        resourceId: 'r',
        repoPath: dir,
        scope: 'all',
        relativePaths: ['c.txt']
      })
    );
    assert.deepEqual(scoped.data?.files, ['c.txt']);
    const escaping = ok(
      await readCurrentDiffGit({
        resourceId: 'r',
        repoPath: dir,
        scope: 'all',
        relativePaths: ['../x']
      })
    );
    assert.equal(escaping.outcome, 'denied');
  });

  it('diffs against the empty tree before the first commit', async () => {
    const dir = tempDir('ovld-unborn-');
    git(dir, ['init', '-q', '-b', 'main']);
    writeFileSync(path.join(dir, 'first.txt'), 'first\n');
    git(dir, ['add', 'first.txt']);
    const value = ok(await readCurrentDiffGit({ resourceId: 'r', repoPath: dir, scope: 'all' }));
    assert.equal(value.head, null);
    assert.deepEqual(value.data?.files, ['first.txt']);
  });

  it('withholds sensitive sections and bounds output', async () => {
    const dir = repo();
    writeFileSync(path.join(dir, '.env'), 'A=1\n');
    git(dir, ['add', '-f', '.env']);
    git(dir, ['commit', '-qm', 'env']);
    writeFileSync(path.join(dir, '.env'), 'A=SECRET\n');
    writeFileSync(path.join(dir, 'a.txt'), 'x\n'.repeat(5000));
    const value = ok(await readCurrentDiffGit({ resourceId: 'r', repoPath: dir, scope: 'all' }));
    assert.deepEqual(value.data?.excludedPaths, ['.env']);
    assert.doesNotMatch(value.data?.diff ?? '', /SECRET/);
    const bounded = ok(
      await readCurrentDiffGit({ resourceId: 'r', repoPath: dir, scope: 'all', maxBytes: 512 })
    );
    assert.equal(bounded.truncated, true);
    assert.ok(Buffer.byteLength(bounded.data?.diff ?? '') <= 512);
  });

  it('parses symmetric headers for sections without ---/+++ lines', () => {
    const diff =
      'diff --git a/x y.bin b/x y.bin\nindex 1..2\nBinary files differ\ndiff --git a/id_rsa b/id_rsa\nindex 1..2\nBinary files differ\n';
    const out = withholdSensitiveDiffSections(diff);
    assert.deepEqual(out.files, ['x y.bin']);
    assert.deepEqual(out.excludedPaths, ['id_rsa']);
  });

  it('shares its arguments with the commit-message diff', () => {
    const dir = repo();
    writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
    const text = collectWorktreeChanges(dir);
    assert.match(text, /Diff against HEAD:\ndiff --git a\/a.txt b\/a.txt/);
  });
});

describe('searchRepositoryTextGit', () => {
  it('finds literal text in tracked and untracked files, skipping ignored, binary and sensitive files', async () => {
    const dir = repo();
    writeFileSync(path.join(dir, 'untracked.ts'), 'const needle = "a.b*c";\n');
    mkdirSync(path.join(dir, 'ignored'));
    writeFileSync(path.join(dir, 'ignored', 'x.ts'), 'a.b*c\n');
    writeFileSync(path.join(dir, '.env'), 'X=a.b*c\n');
    writeFileSync(
      path.join(dir, 'bin.dat'),
      Buffer.concat([Buffer.from('a.b*c'), Buffer.from([0])])
    );
    writeFileSync(path.join(dir, 'regex.txt'), 'aXb*c\n');
    const value = ok(
      await searchRepositoryTextGit({ resourceId: 'r', repoPath: dir, query: 'a.b*c' })
    );
    assert.deepEqual(value.data?.hits, [
      { path: 'untracked.ts', line: 1, text: 'const needle = "a.b*c";' }
    ]);
  });

  it('honours case sensitivity, scope, and the hit bound', async () => {
    const dir = repo();
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'many.txt'), 'Beta\n'.repeat(20));
    const insensitive = ok(
      await searchRepositoryTextGit({
        resourceId: 'r',
        repoPath: dir,
        query: 'BETA',
        caseSensitive: false,
        maxHits: 5
      })
    );
    assert.equal(insensitive.data?.hits.length, 5);
    assert.equal(insensitive.truncated, true);
    const scoped = ok(
      await searchRepositoryTextGit({
        resourceId: 'r',
        repoPath: dir,
        query: 'beta',
        relativePath: 'src'
      })
    );
    assert.equal(scoped.data?.hits.length, 0);
    const outside = ok(
      await searchRepositoryTextGit({
        resourceId: 'r',
        repoPath: dir,
        query: 'x',
        relativePath: '../'
      })
    );
    assert.equal(outside.outcome, 'denied');
    const flag = ok(
      await searchRepositoryTextGit({ resourceId: 'r', repoPath: dir, query: '--output=/tmp/x' })
    );
    assert.equal(flag.outcome, 'ok');
  });
});

describe('readRepositoryTree bounds on the target', () => {
  it('scopes to subPath and caps entries before results cross the queue', async () => {
    const dir = repo();
    mkdirSync(path.join(dir, 'pkg'));
    for (let i = 0; i < 6; i += 1) writeFileSync(path.join(dir, 'pkg', `f${i}.ts`), 'x');
    const provider = new InProcessProvider({
      executionTargetId: 't',
      deviceLabel: null,
      transport: 'in_process'
    });
    const result = await provider.readRepositoryTree({
      resourceId: 'r',
      repoPath: dir,
      subPath: 'pkg',
      maxEntries: 3
    });
    assert.ok(result.ok);
    assert.equal(result.value.entries.length, 3);
    assert.equal(result.value.truncated, true);
    assert.ok(
      result.value.entries.every(entry => entry.path === 'pkg' || entry.path.startsWith('pkg/'))
    );
  });
});

describe('inspection hardening', () => {
  it('runs status, diff, search and file reads without executing configured filters, hooks, fsmonitor, textconv or external diff, and without writing the index', async () => {
    const { dir, markers } = hostileRepo();
    const index = path.join(dir, '.git', 'index');
    const before = statSync(index).mtimeMs;
    const provider = new InProcessProvider({
      executionTargetId: 't',
      deviceLabel: null,
      transport: 'in_process'
    });
    const status = await provider.readGitStatus({ resourceId: 'r', repoPath: dir });
    const diff = await provider.readCurrentDiff({ resourceId: 'r', repoPath: dir, scope: 'all' });
    const search = await provider.searchRepositoryText({
      resourceId: 'r',
      repoPath: dir,
      query: 'BETA'
    });
    const file = await provider.readRepositoryFile({
      resourceId: 'r',
      repoPath: dir,
      relativePath: 'a.txt'
    });
    collectWorktreeChanges(dir);
    for (const result of [status, diff, search, file]) assert.ok(result.ok);
    assert.ok(diff.ok && diff.value.data?.diff.includes('+BETA'));
    assert.deepEqual(
      readdirSync(markers).filter(name => name !== 'fsmonitor.sh'),
      []
    );
    assert.equal(statSync(index).mtimeMs, before);
    assert.equal(existsSync(path.join(dir, '.git', 'index.lock')), false);
  });

  it('kills a command at its timeout, on cancellation, and at the output bound', async () => {
    const bin = tempDir('ovld-fake-git-');
    writeFileSync(
      path.join(bin, 'git'),
      '#!/bin/sh\ncase "$*" in *slow*) exec sleep 10 ;; *flood*) exec yes overlord ;; esac\n'
    );
    chmodSync(path.join(bin, 'git'), 0o755);
    process.env.PATH = `${bin}${path.delimiter}${restorePath}`;
    try {
      const startedAt = Date.now();
      const slow = await runInspectionGit({
        cwd: bin,
        args: ['slow'],
        timeoutMs: 200,
        maxBytes: 1024
      });
      assert.equal(slow.timedOut, true);
      assert.ok(Date.now() - startedAt < 5_000);

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      const cancelled = await runInspectionGit({
        cwd: bin,
        args: ['slow'],
        timeoutMs: 10_000,
        maxBytes: 1024,
        signal: controller.signal
      });
      assert.equal(cancelled.aborted, true);

      const flood = await runInspectionGit({
        cwd: bin,
        args: ['flood'],
        timeoutMs: 10_000,
        maxBytes: 4096
      });
      assert.equal(flood.truncated, true);
      assert.equal(flood.stdout.length, 4096);
    } finally {
      process.env.PATH = restorePath;
    }
  });
});
