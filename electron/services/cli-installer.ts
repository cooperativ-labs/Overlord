import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

const WRAPPER_SCRIPT = `#!/bin/sh
# Overlord CLI wrapper - installed by Overlord desktop app
exec node "%CLI_PATH%" "$@"
`;

export type CliInstallResult =
  | { ok: true; installPath: string; pathInstruction: string }
  | { ok: false; error: string };

function getBundledCliPath(): string | null {
  const isPackaged = app.isPackaged;
  if (!isPackaged) {
    // Dev: bin is at project root (getAppPath = directory containing package.json)
    return path.join(app.getAppPath(), 'bin', 'ovld.mjs');
  }
  const appPath = app.getAppPath();
  const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
  const cliPath = path.join(unpackedPath, 'bin', 'ovld.mjs');
  return fs.existsSync(cliPath) ? cliPath : null;
}

function getInstallDir(): string {
  const home = os.homedir();
  // ~/.local/bin is common on Linux and macOS for user-local binaries
  return path.join(home, '.local', 'bin');
}

export function getCliInstallStatus(): { installed: boolean; installPath?: string } {
  const installDir = getInstallDir();
  const wrapperPath = path.join(installDir, 'ovld');
  const installed = fs.existsSync(wrapperPath);
  return { installed, installPath: installed ? wrapperPath : undefined };
}

export async function installCli(): Promise<CliInstallResult> {
  const bundledPath = getBundledCliPath();
  if (!bundledPath || !fs.existsSync(bundledPath)) {
    return { ok: false, error: 'CLI not found in app bundle.' };
  }

  const installDir = getInstallDir();
  const wrapperPath = path.join(installDir, 'ovld');

  try {
    if (!fs.existsSync(installDir)) {
      fs.mkdirSync(installDir, { recursive: true });
    }

    const script = WRAPPER_SCRIPT.replace('%CLI_PATH%', bundledPath);
    fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to install: ${message}` };
  }

  const pathInstruction =
    installDir === path.join(os.homedir(), '.local', 'bin')
      ? 'Add ~/.local/bin to your PATH if needed (e.g. in ~/.zshrc: export PATH="$HOME/.local/bin:$PATH")'
      : `Ensure ${installDir} is in your PATH`;

  return {
    ok: true,
    installPath: wrapperPath,
    pathInstruction
  };
}
