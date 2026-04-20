/**
 * Tailscale presence detection.
 *
 * Shells out to the `tailscale` CLI to report whether the local machine is
 * part of a tailnet and logged in. The renderer uses this to decide whether
 * to show the "Tailscale SSH" auth option and to badge MagicDNS hostnames.
 *
 * We deliberately do NOT list peers here — host discovery is deferred (see
 * ai/feature-plans/tailscale-ssh-followups.md #2).
 */

import { execFile } from 'node:child_process';
import { ipcMain } from 'electron';

import type { TailscaleStatus } from '../../../../lib/workspace/types';

const CLI_CANDIDATES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/bin/tailscale',
  'tailscale'
];

function runTailscaleStatus(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, ['status', '--json'], { timeout: 4000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

async function probe(): Promise<TailscaleStatus> {
  for (const bin of CLI_CANDIDATES) {
    try {
      const raw = await runTailscaleStatus(bin);
      const parsed = JSON.parse(raw) as {
        BackendState?: string;
        Self?: { HostName?: string; DNSName?: string };
        MagicDNSSuffix?: string;
      };
      const backend = parsed.BackendState ?? 'Unknown';
      const running = backend === 'Running';
      const loggedIn = backend !== 'NeedsLogin' && backend !== 'NoState';
      const dns = parsed.Self?.DNSName?.replace(/\.$/, '') ?? null;
      const selfName = parsed.Self?.HostName ?? (dns ? dns.split('.')[0] : null) ?? null;
      const tailnet = parsed.MagicDNSSuffix?.replace(/\.$/, '') ?? null;
      return { installed: true, running, loggedIn, selfName, tailnet };
    } catch {
      continue;
    }
  }
  return { installed: false, running: false, loggedIn: false, selfName: null, tailnet: null };
}

export function registerTailscaleIpc(): void {
  ipcMain.handle('tailscale:status', async (): Promise<TailscaleStatus> => {
    try {
      return await probe();
    } catch (error) {
      return {
        installed: false,
        running: false,
        loggedIn: false,
        selfName: null,
        tailnet: null,
        error: error instanceof Error ? error.message : 'Tailscale probe failed.'
      };
    }
  });
}
