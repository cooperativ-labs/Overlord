#!/usr/bin/env node

/**
 * Canonical CLI entrypoint. Used by both the npm package and the Electron app.
 * All CLI source files live in _cli/ alongside this file.
 */

import { runCli } from './_cli/index.mjs';

runCli({ primaryCommand: 'ovld' }).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
