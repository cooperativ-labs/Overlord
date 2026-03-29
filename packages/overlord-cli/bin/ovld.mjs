#!/usr/bin/env node

/**
 * Thin wrapper that delegates to the canonical CLI in packages/overlord-cli.
 * All CLI source files live in packages/overlord-cli/bin/_cli/ — this file
 * exists only so that `node bin/ovld.mjs` works during local development.
 */

import { runCli } from '../packages/overlord-cli/bin/_cli/index.mjs';

runCli({ primaryCommand: 'ovld' }).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
