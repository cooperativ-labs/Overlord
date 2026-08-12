import type { DatabaseClient } from '@overlord/database';

import {
  type LaunchSessionDefaults,
  parseLaunchSessionDefaults,
  serializeLaunchSessionDefaults
} from './terminal-profile-types.js';

type ProfileMetadata = {
  avatarUrl?: string;
  agentInstructions?: string;
  /**
   * User-level launch-session default (provider + viewer-on-launch) that new
   * execution targets inherit. Stored here for the same reason `editorScheme` is:
   * it is a per-user tooling preference with no per-machine scope, while
   * `user_execution_target_preferences` is per-machine by construction.
   */
  launchSessionDefaults?: Record<string, unknown>;
};

function parseProfileMetadata(metadataJson: string): ProfileMetadata {
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ProfileMetadata;
  } catch {
    return {};
  }
}

export function avatarUrlFromProfileMetadata(metadataJson: string): string | null {
  const avatarUrl = parseProfileMetadata(metadataJson).avatarUrl;
  return typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl : null;
}

export function agentInstructionsFromProfileMetadata(metadataJson: string): string | null {
  const agentInstructions = parseProfileMetadata(metadataJson).agentInstructions;
  return typeof agentInstructions === 'string' && agentInstructions.trim()
    ? agentInstructions.trim()
    : null;
}

/**
 * The acting user's default execution provider and viewer-on-launch. A profile
 * that has never opted in reads as `direct`, so nothing changes for existing
 * users until they deliberately set a default.
 */
export function launchSessionDefaultsFromProfileMetadata(
  metadataJson: string
): LaunchSessionDefaults {
  return parseLaunchSessionDefaults(parseProfileMetadata(metadataJson).launchSessionDefaults);
}

export function mergeProfileMetadataJson({
  metadataJson,
  avatarUrl,
  agentInstructions,
  launchSessionDefaults
}: {
  metadataJson: string;
  avatarUrl?: string | null;
  agentInstructions?: string | null;
  launchSessionDefaults?: LaunchSessionDefaults | null;
}): string {
  const parsed = { ...parseProfileMetadata(metadataJson) };

  if (launchSessionDefaults !== undefined) {
    if (launchSessionDefaults) {
      parsed.launchSessionDefaults = serializeLaunchSessionDefaults(launchSessionDefaults);
    } else {
      delete parsed.launchSessionDefaults;
    }
  }

  if (avatarUrl !== undefined) {
    if (avatarUrl) parsed.avatarUrl = avatarUrl;
    else delete parsed.avatarUrl;
  }

  if (agentInstructions !== undefined) {
    const trimmed = agentInstructions?.trim() ?? '';
    if (trimmed) parsed.agentInstructions = trimmed;
    else delete parsed.agentInstructions;
  }

  return JSON.stringify(parsed);
}

export async function loadAgentInstructionsForWorkspaceUser({
  db,
  workspaceUserId
}: {
  db: DatabaseClient;
  workspaceUserId: string | null;
}): Promise<string | null> {
  if (!workspaceUserId) return null;

  const row = (await db.get(
    `SELECT p.metadata_json
         FROM profiles p
         JOIN workspace_users wu ON wu.profile_id = p.id
        WHERE wu.id = ? AND p.deleted_at IS NULL`,
    [workspaceUserId]
  )) as { metadata_json: string } | undefined;

  if (!row) return null;
  return agentInstructionsFromProfileMetadata(row.metadata_json);
}
