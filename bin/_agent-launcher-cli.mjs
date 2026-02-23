#!/usr/bin/env node

/**
 * @deprecated This module is kept for backward compatibility.
 * New code should use bin/_cli/index.mjs directly.
 */

import { runCli } from './_cli/index.mjs';

export async function runAgentLauncherCli({ primaryCommand }) {
  await runCli({ primaryCommand });
}
