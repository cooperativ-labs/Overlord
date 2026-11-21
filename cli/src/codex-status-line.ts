import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';

import { compareSemver } from './claude-hook-health.js';
import { setTomlScalar } from './connectors.js';

/**
 * Opt-in Codex status line (`ovld agent-setup codex --status-line`), `terminal.statusSurface`.
 *
 * Codex 0.171 shows a custom footer from an MCP statusline provider when the experimental
 * feature `tui_extensions_statusline` is on and `tui.status_line_provider` names the provider's
 * server and tool. The Overlord Codex plugin's MCP server (`overlord`) advertises one
 * (`overlord_status_line`, connectors/core/scripts/overlord-mcp.mjs). Codex reads the selection
 * only from user-level config, never from a project's, so setup writes `~/.codex/config.toml`:
 *
 * - only when the person asked;
 * - turning the feature on only when it is unset, never overriding an explicit `false`;
 * - selecting the Overlord provider only when no provider is selected, so a status line the
 *   person chose (another provider, or an explicit `"default"`) is never replaced.
 *
 * The same Codex config is read by a private Overlord app server, so one setting serves both
 * the hooks and the app-server modes.
 */

export const CODEX_STATUS_LINE_FEATURE = 'tui_extensions_statusline';
export const CODEX_STATUS_LINE_SERVER = 'overlord';
export const CODEX_STATUS_LINE_TOOL = 'overlord_status_line';
/** First Codex release that renders MCP statusline providers (#61979). */
export const CODEX_STATUS_LINE_MIN_VERSION = '0.171.0';

export type CodexStatusLineSetup = {
  status:
    | 'installed'
    | 'would-install'
    | 'unchanged'
    | 'kept-existing'
    | 'feature-disabled'
    | 'unreadable';
  configPath: string;
  existingProvider: unknown;
  codexVersion: string | null;
  message: string;
};

export type CodexStatusLineInspection = {
  state: 'overlord' | 'other' | 'none' | 'unreadable';
  feature: boolean | null;
  provider: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isOverlordCodexStatusLineProvider(provider: unknown): boolean {
  const record = asRecord(provider);
  return record?.server === CODEX_STATUS_LINE_SERVER && record?.tool === CODEX_STATUS_LINE_TOOL;
}

/** Read-only: the Codex config's status line feature flag and provider selection. */
export function inspectCodexStatusLine(configPath: string): CodexStatusLineInspection {
  let config: Record<string, unknown> = {};
  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf8');
      config = raw.trim() ? (parse(raw) as Record<string, unknown>) : {};
    }
  } catch {
    return { state: 'unreadable', feature: null, provider: null };
  }
  const featureValue = asRecord(config.features)?.[CODEX_STATUS_LINE_FEATURE];
  const feature = typeof featureValue === 'boolean' ? featureValue : null;
  const provider = asRecord(config.tui)?.status_line_provider;
  if (provider === undefined) return { state: 'none', feature, provider: null };
  return {
    state: isOverlordCodexStatusLineProvider(provider) ? 'overlord' : 'other',
    feature,
    provider
  };
}

/** The config text with the feature on (when unset) and the Overlord provider selected. */
export function mergeCodexStatusLineConfig(
  existingContent: string,
  inspection: CodexStatusLineInspection
): string {
  let content = existingContent;
  if (inspection.feature === null) {
    content = setTomlScalar({
      content,
      section: 'features',
      key: CODEX_STATUS_LINE_FEATURE,
      value: 'true'
    });
  }
  if (inspection.state === 'none') {
    content = setTomlScalar({
      content,
      section: 'tui',
      key: 'status_line_provider',
      value: `{ server = "${CODEX_STATUS_LINE_SERVER}", tool = "${CODEX_STATUS_LINE_TOOL}" }`
    });
  }
  return content;
}

function versionNote(codexVersion: string | null): string {
  if (!codexVersion || compareSemver(codexVersion, CODEX_STATUS_LINE_MIN_VERSION) >= 0) return '';
  return (
    ` Codex ${codexVersion} cannot show it yet: custom status lines need Codex ` +
    `${CODEX_STATUS_LINE_MIN_VERSION} or later, and take effect after you upgrade.`
  );
}

export function configureCodexStatusLine({
  codexHome,
  codexVersion,
  dryRun = false
}: {
  codexHome: string;
  codexVersion: string | null;
  dryRun?: boolean;
}): CodexStatusLineSetup {
  const configPath = path.join(codexHome, 'config.toml');
  const inspection = inspectCodexStatusLine(configPath);
  const base = { configPath, existingProvider: inspection.provider, codexVersion };
  const note = versionNote(codexVersion);

  if (inspection.state === 'unreadable') {
    return {
      ...base,
      status: 'unreadable',
      message:
        `Did not add the Codex status line: ${configPath} is not valid TOML. ` +
        'Fix the file, then re-run `ovld agent-setup codex --status-line`.'
    };
  }
  if (inspection.state === 'other') {
    return {
      ...base,
      status: 'kept-existing',
      message:
        `Kept your Codex status line selection (${configPath}). To switch, open /statusline in ` +
        'Codex, choose "Choose a status line provider", then "Overlord mission".' +
        note
    };
  }
  if (inspection.feature === false) {
    return {
      ...base,
      status: 'feature-disabled',
      message:
        `Did not add the Codex status line: ${configPath} turns off ` +
        `\`features.${CODEX_STATUS_LINE_FEATURE}\`. Turn on "Custom status line" in /experimental, ` +
        'restart Codex, then re-run `ovld agent-setup codex --status-line`.'
    };
  }
  if (inspection.state === 'overlord' && inspection.feature === true) {
    return {
      ...base,
      status: 'unchanged',
      message: `Codex status line already shows Overlord (${configPath}).${note}`
    };
  }
  if (dryRun) {
    return {
      ...base,
      status: 'would-install',
      message: `Would select the Overlord status line in ${configPath}.${note}`
    };
  }

  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const merged = mergeCodexStatusLineConfig(existing, inspection);
  if (!selectsOverlord(merged)) {
    // The text merge only understands `[features]` and `[tui]` tables; a layout it cannot edit
    // (dotted `tui.*` keys at the top level, say) is left to the person, never half-written.
    return {
      ...base,
      status: 'unreadable',
      message:
        `Did not add the Codex status line: could not edit ${configPath} safely. Add ` +
        `\`${CODEX_STATUS_LINE_FEATURE} = true\` under [features] and ` +
        `\`status_line_provider = { server = "${CODEX_STATUS_LINE_SERVER}", tool = ` +
        `"${CODEX_STATUS_LINE_TOOL}" }\` under [tui].`
    };
  }
  writeConfigAtomically(configPath, merged);
  return {
    ...base,
    status: 'installed',
    message:
      `Selected the Overlord status line in ${configPath} (feature ` +
      `\`${CODEX_STATUS_LINE_FEATURE}\`, provider ${CODEX_STATUS_LINE_SERVER}/` +
      `${CODEX_STATUS_LINE_TOOL}). It shows the bound mission and objective in new Codex ` +
      'sessions; pick another provider in /statusline to turn it off.' +
      note
  };
}

function selectsOverlord(content: string): boolean {
  try {
    const config = parse(content) as Record<string, unknown>;
    return (
      asRecord(config.features)?.[CODEX_STATUS_LINE_FEATURE] === true &&
      isOverlordCodexStatusLineProvider(asRecord(config.tui)?.status_line_provider)
    );
  } catch {
    return false;
  }
}

/** Replace config.toml atomically, keeping its permissions. Codex owns the file and directory. */
function writeConfigAtomically(configPath: string, contents: string): void {
  const mode = existsSync(configPath) ? statSync(configPath).mode & 0o777 : 0o600;
  mkdirSync(path.dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode });
    renameSync(temporary, configPath);
  } finally {
    rmSync(temporary, { force: true });
  }
}
