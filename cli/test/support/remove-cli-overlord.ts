import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { after } from 'node:test';

const cliOverlordDir = path.resolve(import.meta.dirname, '..', '..', '.overlord');

// This module is loaded via `--import`, so every test *file* runs its own copy of
// the hook in its own process. All of those processes target the same directory,
// which means the removals race: one worker can unlink an entry another worker is
// still recreating, and plain `rmSync` then fails with ENOTEMPTY.
//
// `maxRetries` absorbs the ordinary interleaving, and the catch makes the rest
// best-effort — this is disposable residue from running `ovld` with the CLI
// package as its working directory, so failing to delete it must never fail the
// suite that just passed.
after(() => {
  if (!existsSync(cliOverlordDir)) return;
  try {
    rmSync(cliOverlordDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  } catch {
    // A concurrent worker either removed it already or is still writing to it.
  }
});
