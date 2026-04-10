#!/usr/bin/env node

/**
 * Post-install message for Overlord CLI
 * Shown after `npm install -g overlord-cli` or `yarn global add overlord-cli`
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Only show message if this is a global install (not local dev)
const isGlobalInstall = process.env.npm_config_global === 'true' ||
                        process.env.npm_execpath?.includes('yarn') ||
                        !__dirname.includes('node_modules');

if (!isGlobalInstall) {
  process.exit(0);
}

const green = s => `\x1b[32m${s}\x1b[0m`;
const cyan = s => `\x1b[36m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;

console.log(`
${green('✓')} Overlord CLI installed successfully!

${bold('Next step:')} Configure agent connectors

  ${cyan('ovld setup')}

This will guide you through:
  • Selecting which agent connectors to install (Claude, Cursor, etc.)
  • Configuring agent permissions for Overlord protocol access

You can also run ${cyan('ovld setup <agent>')} to install a specific agent connector,
or ${cyan('ovld doctor')} to check your installation status.

Run ${cyan('ovld help')} to see all available commands.
`);
