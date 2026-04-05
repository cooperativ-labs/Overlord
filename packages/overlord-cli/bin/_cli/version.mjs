#!/usr/bin/env node

import { getCurrentCliVersion } from './cli-update.mjs';

export function runVersionCommand() {
  console.log(`Overlord CLI ${getCurrentCliVersion()}`);
}
