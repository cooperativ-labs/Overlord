#!/usr/bin/env node

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

export function runVersionCommand() {
  console.log(`Overlord CLI ${version}`);
}
