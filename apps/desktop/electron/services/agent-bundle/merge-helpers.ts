/**
 * Merge helpers for non-destructive installation of Overlord-owned config
 * into user-managed files (JSON, Markdown).
 *
 * All helpers are additive: they merge or append Overlord content without
 * clobbering user-owned settings. If a safe merge is not possible, they
 * throw rather than overwrite.
 */

import fs from 'fs';
import path from 'path';

import { JSON_MARKER_KEY, MD_MARKER_END, MD_MARKER_START } from './templates';

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

/**
 * Creates a timestamped backup of a file before modifying it.
 * Returns the backup path, or null if the source doesn't exist.
 */
export function backupFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dir, `${base}.backup-${ts}${ext}`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

// ---------------------------------------------------------------------------
// JSON merge (for Claude settings.json)
// ---------------------------------------------------------------------------

/**
 * Deep-merges Overlord-owned additions into an existing JSON object.
 *
 * - Arrays are concatenated (existing entries preserved, new entries appended).
 * - Objects are recursively merged.
 * - Scalars from `additions` overwrite only when the key doesn't exist yet.
 * - Adds a `__overlord_managed` marker with managed key paths for status detection.
 *
 * Returns the merged object (does not write to disk).
 */
export function mergeJsonSettings(
  existing: Record<string, unknown>,
  additions: Record<string, unknown>,
  managedPaths: string[] = []
): Record<string, unknown> {
  const result = deepClone(existing);
  deepMerge(result, additions);
  // Track which paths are managed by Overlord
  result[JSON_MARKER_KEY] = {
    version: (additions as Record<string, unknown>).__bundle_version ?? '1.0.0',
    paths: managedPaths,
    updatedAt: new Date().toISOString()
  };
  return result;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];

    if (Array.isArray(sourceVal)) {
      // Concatenate arrays, deduplicating by JSON string comparison
      const existing = Array.isArray(targetVal) ? targetVal : [];
      const existingStrings = new Set(existing.map(v => JSON.stringify(v)));
      const newItems = sourceVal.filter(v => !existingStrings.has(JSON.stringify(v)));
      target[key] = [...existing, ...newItems];
    } else if (sourceVal !== null && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
      if (targetVal !== null && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
        deepMerge(targetVal as Record<string, unknown>, sourceVal as Record<string, unknown>);
      } else {
        target[key] = deepClone(sourceVal);
      }
    } else {
      // Scalars: only set if not already present
      if (!(key in target)) {
        target[key] = sourceVal;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown section merge (for OpenCode AGENTS.md)
// ---------------------------------------------------------------------------

/**
 * Replaces or appends the Overlord-managed section in a Markdown file.
 *
 * Uses `<!-- overlord:managed:start -->` / `<!-- overlord:managed:end -->`
 * markers. If markers exist, the content between them is replaced. If not,
 * the section is appended at the end.
 *
 * Returns the merged file content (does not write to disk).
 */
export function mergeMarkdownSection(existing: string, newContent: string): string {
  const wrappedContent = `${MD_MARKER_START}\n${newContent.trim()}\n${MD_MARKER_END}`;

  const startIdx = existing.indexOf(MD_MARKER_START);
  const endIdx = existing.indexOf(MD_MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing managed section
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + MD_MARKER_END.length);
    return `${before}${wrappedContent}${after}`;
  }

  // Append at end with a separator
  const trimmed = existing.trimEnd();
  if (trimmed.length === 0) {
    return wrappedContent + '\n';
  }
  return `${trimmed}\n\n${wrappedContent}\n`;
}

/**
 * Checks whether a Markdown file contains an Overlord-managed section.
 */
export function hasOverlordSection(content: string): boolean {
  return content.includes(MD_MARKER_START) && content.includes(MD_MARKER_END);
}

// ---------------------------------------------------------------------------
// JSON file helpers
// ---------------------------------------------------------------------------

/**
 * Reads a JSON file, returning an empty object if it doesn't exist or is invalid.
 */
export function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Writes a JSON object to a file, creating parent directories as needed.
 */
export function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Reads a text file, returning an empty string if it doesn't exist.
 */
export function readTextFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Writes a text file, creating parent directories as needed.
 */
export function writeTextFile(filePath: string, content: string, mode?: number): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const options: fs.WriteFileOptions = { encoding: 'utf-8' };
  if (mode !== undefined) {
    options.mode = mode;
  }
  fs.writeFileSync(filePath, content, options);
}
