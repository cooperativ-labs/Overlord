import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveGlobalDataDir } from '../../database/src/local-paths.ts';

import type { ActiveBackend, BackendProfile } from './backend-profiles.js';

/** The CLI's global `overlord.toml`, inside the shared per-user data directory. */
export function globalConfigPath(): string {
  return path.join(resolveGlobalDataDir(), 'overlord.toml');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function syncOverlordTomlForProfile({
  profile,
  shellOrigin
}: {
  profile: BackendProfile;
  shellOrigin: string;
}): void {
  const targetPath = globalConfigPath();
  mkdirSync(path.dirname(targetPath), { recursive: true });

  const backendMode = profile.mode === 'local' ? 'local' : 'cloud';
  const backendUrl = profile.mode === 'local' ? shellOrigin : profile.backendUrl;
  const parsedShell = new URL(shellOrigin);
  const webHost = parsedShell.hostname;
  const webPort = parsedShell.port
    ? Number(parsedShell.port)
    : parsedShell.protocol === 'https:'
      ? 443
      : 80;

  const existing = existsSync(targetPath) ? readExistingConfig(targetPath) : {};
  const next: OverlordTomlValues = {
    instanceName: existing.instanceName ?? 'Local Overlord',
    backendMode,
    backendUrl,
    webHost: existing.webHost ?? webHost,
    webPort: existing.webPort ?? webPort,
    sqlStudioEnabled: existing.sqlStudioEnabled ?? false,
    sqlStudioHost: existing.sqlStudioHost ?? '127.0.0.1',
    sqlStudioPort: existing.sqlStudioPort ?? 4311,
    sqlStudioBinary: existing.sqlStudioBinary ?? 'sql-studio',
    defaultAgent: existing.defaultAgent ?? 'claude'
  };

  writeFileSync(targetPath, renderOverlordToml(next));
}

export type OverlordTomlValues = {
  instanceName: string;
  backendMode: 'local' | 'cloud';
  backendUrl: string;
  webHost: string;
  webPort: number;
  sqlStudioEnabled: boolean;
  sqlStudioHost: string;
  sqlStudioPort: number;
  sqlStudioBinary: string;
  defaultAgent: string;
};

/** The one renderer for the desktop-written `overlord.toml`. */
export function renderOverlordToml(values: OverlordTomlValues): string {
  return `# Overlord instance configuration
instance_name = ${tomlString(values.instanceName)}
backend_mode = ${tomlString(values.backendMode)}
backend_url = ${tomlString(values.backendUrl)}
web_host = ${tomlString(values.webHost)}
web_port = ${values.webPort}
sql_studio_enabled = ${values.sqlStudioEnabled ? 'true' : 'false'}
sql_studio_host = ${tomlString(values.sqlStudioHost)}
sql_studio_port = ${values.sqlStudioPort}
sql_studio_binary = ${tomlString(values.sqlStudioBinary)}
default_agent = ${tomlString(values.defaultAgent)}
`;
}

type ExistingConfig = {
  instanceName?: string;
  webHost?: string;
  webPort?: number;
  sqlStudioEnabled?: boolean;
  sqlStudioHost?: string;
  sqlStudioPort?: number;
  sqlStudioBinary?: string;
  defaultAgent?: string;
};

function readExistingConfig(filePath: string): ExistingConfig {
  const text = readFileSyncSafe(filePath);
  const config: ExistingConfig = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    const value = parseTomlString(rawValue);
    switch (key) {
      case 'instance_name':
        config.instanceName = value;
        break;
      case 'web_host':
        config.webHost = value;
        break;
      case 'web_port':
        config.webPort = Number(value);
        break;
      case 'sql_studio_enabled':
        config.sqlStudioEnabled = value === 'true';
        break;
      case 'sql_studio_host':
        config.sqlStudioHost = value;
        break;
      case 'sql_studio_port':
        config.sqlStudioPort = Number(value);
        break;
      case 'sql_studio_binary':
        config.sqlStudioBinary = value;
        break;
      case 'default_agent':
        config.defaultAgent = value;
        break;
      default:
        break;
    }
  }
  return config;
}

function readFileSyncSafe(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function parseTomlString(rawValue: string): string {
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

export function activeBackendForRenderer(active: ActiveBackend): {
  id: string;
  label: string;
  mode: 'local' | 'remote';
  backendUrl: string;
  apiBaseUrl: string;
  shellOrigin: string;
} {
  return {
    id: active.id,
    label: active.label,
    mode: active.mode,
    backendUrl: active.apiBaseUrl,
    apiBaseUrl: active.apiBaseUrl,
    shellOrigin: active.shellOrigin
  };
}
