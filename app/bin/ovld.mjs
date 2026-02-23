#!/usr/bin/env node

import { runCli } from './_cli/index.mjs';

runCli({ primaryCommand: 'ovld' }).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
