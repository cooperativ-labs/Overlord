import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRepoPath } from './config.js';
import { CliError } from './errors.js';

/** Marker in adapter skill templates where connector core body is interpolated. */
export const CONNECTOR_CORE_MARKER = '<!-- @connector-core -->';

export const CONNECTOR_CORE_SKILL_RELATIVE_PATH = 'skills/overlord-mission/SKILL.md';
export const CONNECTOR_CORE_REFERENCE_PREFIX = 'skills/overlord-mission/reference/';

/**
 * The local MCP shim is a single core script rendered per adapter. The only
 * adapter-specific values are the default agent identifier and the reported
 * `serverInfo.name`, both spelled with this placeholder in the core file.
 */
export const CONNECTOR_CORE_MCP_SHIM_RELATIVE_PATH = 'scripts/overlord-mcp.mjs';
export const CONNECTOR_ADAPTER_KEY_PLACEHOLDER = '__OVERLORD_ADAPTER_KEY__';

/**
 * Locate `connectors/core/overlord-mission`. The CLI package ships a copy under
 * `dist/connectors`, but source checkouts and development overrides are also
 * supported.
 */
export function connectorCoreRoot(): string {
  const override = process.env.OVERLORD_CONNECTORS_DIR;
  if (override) {
    const candidate = path.join(path.dirname(override), 'core', 'overlord-mission');
    if (existsSync(candidate)) return candidate;
  }

  const packaged = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'connectors',
    'core',
    'overlord-mission'
  );
  if (existsSync(packaged)) return packaged;

  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, 'connectors', 'core', 'overlord-mission');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return resolveRepoPath('connectors/core/overlord-mission');
}

/**
 * `connectors/core/scripts` — sibling of the core skill directory returned by
 * {@link connectorCoreRoot}, resolved through it so both follow the same
 * packaged/source/override lookup.
 */
export function connectorCoreScriptsRoot(coreRoot = connectorCoreRoot()): string {
  return path.join(path.dirname(coreRoot), 'scripts');
}

export function isConnectorCoreMcpShimPath(relativePath: string): boolean {
  return relativePath === CONNECTOR_CORE_MCP_SHIM_RELATIVE_PATH;
}

export function isConnectorCoreSkillPath(relativePath: string): boolean {
  return relativePath === CONNECTOR_CORE_SKILL_RELATIVE_PATH;
}

export function isConnectorCoreReferencePath(relativePath: string): boolean {
  return (
    relativePath.startsWith(CONNECTOR_CORE_REFERENCE_PREFIX) &&
    relativePath.endsWith('.md') &&
    !relativePath.includes('..')
  );
}

export function stripMarkdownFrontmatter(text: string): string {
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return text;
  return text.slice(end + 5);
}

export function readConnectorCoreSkillBody(coreRoot = connectorCoreRoot()): string {
  const coreSkillPath = path.join(coreRoot, 'SKILL.md');
  if (!existsSync(coreSkillPath)) {
    throw new CliError({
      message: `Connector core skill missing at ${coreSkillPath}.`
    });
  }
  return stripMarkdownFrontmatter(readFileSync(coreSkillPath, 'utf8')).trim();
}

export function renderConnectorSkill({
  adapterTemplate,
  coreRoot = connectorCoreRoot()
}: {
  adapterTemplate: string;
  coreRoot?: string;
}): string {
  if (!adapterTemplate.includes(CONNECTOR_CORE_MARKER)) {
    throw new CliError({
      message:
        `Adapter skill template is missing ${CONNECTOR_CORE_MARKER}. ` +
        `Add the marker where connector core content should be interpolated.`
    });
  }

  const coreBody = readConnectorCoreSkillBody(coreRoot);
  const rendered = adapterTemplate.replace(CONNECTOR_CORE_MARKER, coreBody).trimEnd();
  return `${rendered}\n`;
}

export function readConnectorCoreReference({
  relativePath,
  coreRoot = connectorCoreRoot()
}: {
  relativePath: string;
  coreRoot?: string;
}): Buffer {
  if (!isConnectorCoreReferencePath(relativePath)) {
    throw new CliError({
      message: `Not a connector core reference path: ${relativePath}`
    });
  }

  const referencePath = path.join(coreRoot, 'reference', path.basename(relativePath));
  if (!existsSync(referencePath)) {
    throw new CliError({
      message: `Connector core reference missing at ${referencePath}.`
    });
  }
  return readFileSync(referencePath);
}

/**
 * Render the shared local MCP shim for one adapter. The result must stay a
 * standalone runnable `.mjs`: it is copied into the user's home and started
 * directly by the harness, so it may not import anything repo-local.
 */
export function renderConnectorMcpShim({
  adapterKey,
  coreRoot = connectorCoreRoot()
}: {
  adapterKey: string;
  coreRoot?: string;
}): string {
  const shimPath = path.join(connectorCoreScriptsRoot(coreRoot), 'overlord-mcp.mjs');
  if (!existsSync(shimPath)) {
    throw new CliError({
      message: `Connector core MCP shim missing at ${shimPath}.`
    });
  }
  const source = readFileSync(shimPath, 'utf8');
  if (!source.includes(CONNECTOR_ADAPTER_KEY_PLACEHOLDER)) {
    throw new CliError({
      message:
        `Connector core MCP shim at ${shimPath} is missing ` +
        `${CONNECTOR_ADAPTER_KEY_PLACEHOLDER}. The adapter key must stay a substitution point.`
    });
  }
  return source.replaceAll(CONNECTOR_ADAPTER_KEY_PLACEHOLDER, adapterKey);
}

/**
 * Adapter key for substitution. `setupConnector` passes it explicitly; the
 * fallback keeps the older `sourceDir`-only callers working, since every
 * adapter source directory is named for its key.
 */
function resolveAdapterKey({
  sourceDir,
  adapterKey
}: {
  sourceDir: string;
  adapterKey?: string;
}): string {
  return adapterKey ?? path.basename(sourceDir);
}

export function managedFileSourceExists({
  sourceDir,
  relativePath,
  coreRoot = connectorCoreRoot()
}: {
  sourceDir: string;
  relativePath: string;
  coreRoot?: string;
}): boolean {
  if (isConnectorCoreReferencePath(relativePath)) {
    return existsSync(path.join(coreRoot, 'reference', path.basename(relativePath)));
  }
  if (isConnectorCoreMcpShimPath(relativePath)) {
    return existsSync(path.join(connectorCoreScriptsRoot(coreRoot), 'overlord-mcp.mjs'));
  }
  return existsSync(path.join(sourceDir, relativePath));
}

export function resolveManagedFileContents({
  sourceDir,
  relativePath,
  adapterKey,
  coreRoot = connectorCoreRoot()
}: {
  sourceDir: string;
  relativePath: string;
  adapterKey?: string;
  coreRoot?: string;
}): Buffer {
  if (isConnectorCoreReferencePath(relativePath)) {
    return readConnectorCoreReference({ relativePath, coreRoot });
  }

  if (isConnectorCoreMcpShimPath(relativePath)) {
    const rendered = renderConnectorMcpShim({
      adapterKey: resolveAdapterKey({ sourceDir, adapterKey }),
      coreRoot
    });
    return Buffer.from(rendered, 'utf8');
  }

  if (isConnectorCoreSkillPath(relativePath)) {
    const templatePath = path.join(sourceDir, relativePath);
    if (!existsSync(templatePath)) {
      throw new CliError({
        message: `Adapter skill template missing at ${templatePath}.`
      });
    }
    const rendered = renderConnectorSkill({
      adapterTemplate: readFileSync(templatePath, 'utf8'),
      coreRoot
    });
    return Buffer.from(rendered, 'utf8');
  }

  const sourcePath = path.join(sourceDir, relativePath);
  if (!existsSync(sourcePath)) {
    throw new CliError({
      message: `Declared managed file missing from connector source: ${relativePath}`
    });
  }
  return readFileSync(sourcePath);
}
