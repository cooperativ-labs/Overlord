import { type Permission } from '@overlord/auth';
import { missionDisplayIdFromObjectiveRef } from '@overlord/contract';

import { type ServiceContext } from '../../packages/core/service/context.ts';
import { ApiError } from '../errors.ts';

// ---- Protocol request envelope and flag helpers --------------------------
//
// Shared by the dispatcher in backend/protocol.ts and every subcommand group
// under ./protocol/. This module imports nothing from either, so a group module
// never has to reach back through the dispatcher for its helpers.

/** Envelope posted by the CLI's `runProtocolCommand`. */
export interface ProtocolRequestBody {
  args?: string[];
  positional?: string[];
  flags?: Record<string, string | boolean>;
  /**
   * Per-flag payloads keyed by the `--*-file` flag name, so multiple file inputs
   * in one call remain unambiguous.
   */
  fileInputs?: Record<string, string>;
  externalSessionId?: string | null;
}

export type Handler = (ctx: ServiceContext, body: ProtocolRequestBody) => unknown;

/**
 * One protocol subcommand: its handler and the RBAC permission enforced before
 * dispatch. `null` means authorization happens inside the handler (or, for
 * `auth-status`, not at all); it is always an explicit statement, so a
 * subcommand cannot be registered without deciding its permission.
 */
export type SubcommandEntry = {
  handler: Handler;
  permission: Permission | null;
};

/** A group of subcommands, spread into the dispatch table in backend/protocol.ts. */
export type SubcommandTable = Record<string, SubcommandEntry>;

function flagsOf(body: ProtocolRequestBody): Record<string, string | boolean> {
  return body.flags ?? {};
}

/** String value of a `--flag value` pair, or undefined for absent/boolean flags. */
export function strFlag(body: ProtocolRequestBody, name: string): string | undefined {
  const value = flagsOf(body)[name];
  return typeof value === 'string' ? value : undefined;
}

/** True when a boolean flag is present (`--flag` or `--flag true`). */
export function boolFlag(body: ProtocolRequestBody, name: string): boolean {
  const value = flagsOf(body)[name];
  return value === true || value === 'true';
}

/**
 * Optional tri-state boolean from `--flag` / `--no-flag` / `--flag true|false`.
 * `--no-flag` wins when both are present.
 */
export function optionalBoolFlag({
  body,
  name,
  negatedName
}: {
  body: ProtocolRequestBody;
  name: string;
  negatedName: string;
}): boolean | undefined {
  if (boolFlag(body, negatedName)) return false;
  const value = flagsOf(body)[name];
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new ApiError(400, `${name} must be true or false`);
}

/** True when the flag appears at all, regardless of value. */
export function hasFlag(body: ProtocolRequestBody, name: string): boolean {
  return name in flagsOf(body);
}

/**
 * Resolve text supplied either inline (`--summary "..."`) or via the file
 * variant (`--summary-file -`). The CLI streams file contents in the `fileInputs`
 * envelope, so any presence of the file flag means "use that payload" — this is
 * how the contract avoids shell-quoting failures for special characters.
 */
export function resolveInput(
  body: ProtocolRequestBody,
  valueFlag: string,
  fileFlag: string
): string | undefined {
  const direct = strFlag(body, valueFlag);
  if (direct !== undefined) return direct;
  if (hasFlag(body, fileFlag)) {
    const payload = body.fileInputs?.[fileFlag];
    if (payload === undefined) {
      throw new ApiError(400, `Missing file input for ${fileFlag}`, undefined, 'invalid_input');
    }
    return payload;
  }
  return undefined;
}

/** Native session id: explicit flag wins, else the CLI's resolved value. */
export function externalSessionId(body: ProtocolRequestBody): string | null | undefined {
  const flag = strFlag(body, '--external-session-id');
  if (flag !== undefined) return flag;
  return body.externalSessionId ?? undefined;
}

export function requireFlag(body: ProtocolRequestBody, name: string): string {
  const value = strFlag(body, name);
  if (value === undefined || value.trim() === '') {
    throw new ApiError(400, `Missing required flag: ${name}`);
  }
  return value;
}

/**
 * The mission reference for a subcommand, derived from `--objective-id` when the
 * caller supplied only that.
 *
 * An objective display id spells its parent mission (`coo:756.k7xm` -> `coo:756`),
 * so an agent that has been handed one identifier can address every subcommand
 * with it. The CLI derives this client-side too, but hosted MCP and any direct
 * REST caller reach this handler with an untouched body, so the derivation has
 * to exist on both sides. An objective UUID names no mission, so it cannot
 * stand in for one.
 */
export function missionRefFlag(body: ProtocolRequestBody): string {
  const explicit = strFlag(body, '--mission-id');
  if (explicit !== undefined && explicit.trim() !== '') return explicit;

  const derived = missionDisplayIdFromObjectiveRef(strFlag(body, '--objective-id'));
  if (derived) return derived;

  throw new ApiError(
    400,
    'Missing required flag: --mission-id (pass it, or an objective display id such as coo:756.k7xm as --objective-id)'
  );
}

/** Optional objective reference (UUID or `{mission.display_id}.{display_key}`). */
export function objectiveRefFlag(body: ProtocolRequestBody): string | null {
  const value = strFlag(body, '--objective-id');
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
}

/** Parse a JSON flag supplied inline (`--x-json`) or through its per-flag file payload. */
export function parseJsonInput<T>(
  body: ProtocolRequestBody,
  jsonFlag: string,
  fileFlag: string
): T | undefined {
  const raw = resolveInput(body, jsonFlag, fileFlag);
  if (raw === undefined || raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new ApiError(
      400,
      `Invalid JSON for ${jsonFlag}`,
      err instanceof Error ? err.message : undefined
    );
  }
}

export function parseJsonArrayInput<T>(
  body: ProtocolRequestBody,
  jsonFlag: string,
  fileFlag: string,
  label: string
): T[] | undefined {
  const input = parseJsonInput<unknown>(body, jsonFlag, fileFlag);
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) {
    throw new ApiError(400, `${label} must be a JSON array`, undefined, 'invalid_input');
  }
  return input as T[];
}

export function parseJsonObjectInput(
  body: ProtocolRequestBody,
  jsonFlag: string,
  fileFlag: string,
  label: string
): Record<string, unknown> | undefined {
  const input = parseJsonInput<unknown>(body, jsonFlag, fileFlag);
  if (input === undefined) return undefined;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ApiError(400, `${label} must be a JSON object`, undefined, 'invalid_input');
  }
  return input as Record<string, unknown>;
}

export function intFlag(body: ProtocolRequestBody, name: string): number | undefined {
  const value = strFlag(body, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
