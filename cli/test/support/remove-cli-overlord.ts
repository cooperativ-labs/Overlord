import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { after } from 'node:test';

const cliOverlordDir = path.resolve(import.meta.dirname, '..', '..', '.overlord');

after(() => {
  if (existsSync(cliOverlordDir)) {
    rmSync(cliOverlordDir, { recursive: true, force: true });
  }
});
