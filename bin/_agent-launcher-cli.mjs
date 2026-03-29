#!/usr/bin/env node

/**
 * @deprecated This module is kept for backward compatibility.
 * New code should use packages/overlord-cli/bin/_cli/index.mjs directly.
 */

import { runCli } from '../packages/overlord-cli/bin/_cli/index.mjs';

export async function runAgentLauncherCli({ primaryCommand }) {
  await runCli({ primaryCommand });
}
