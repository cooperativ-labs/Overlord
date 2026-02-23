#!/usr/bin/env node

import { runAgentLauncherCli } from "./_agent-launcher-cli.mjs";

runAgentLauncherCli({ primaryCommand: "ovld" }).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

