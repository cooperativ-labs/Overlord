import { type ChangeRationaleInput } from '../../packages/core/service/protocol.ts';
import { ApiError } from '../errors.ts';

import { hasFlag, parseJsonObjectInput, type ProtocolRequestBody } from './flags.ts';

// ---- Delivery payload parsing ---------------------------------------------
//
// The delivery envelope and retired change-tracking inputs shared by `update`
// and `deliver` (./session.ts) and `record-work` (./missions.ts).

const RETIRED_SHARED_CHANGE_TRACKING_FLAGS = [
  '--no-file-changes',
  '--skip-rationale-for-json',
  '--skip-rationale-for-file',
  '--observed-dirty-paths-json',
  '--observed-dirty-paths-file'
] as const;

export const RETIRED_CHANGE_TRACKING_FLAGS = [
  '--track-changed-files',
  '--changed-files-json',
  '--changed-files-file',
  ...RETIRED_SHARED_CHANGE_TRACKING_FLAGS
] as const;

const RETIRED_SHARED_CHANGE_TRACKING_FIELDS = [
  'noFileChanges',
  'skipRationaleFor',
  'observedDirtyPaths',
  'changed_files',
  'no_file_changes',
  'skip_rationale_for',
  'observed_dirty_paths'
] as const;

const RETIRED_CHANGE_TRACKING_FIELDS = [
  'changedFiles',
  ...RETIRED_SHARED_CHANGE_TRACKING_FIELDS
] as const;

export const RETIRED_RECORD_WORK_FLAGS = RETIRED_SHARED_CHANGE_TRACKING_FLAGS;
export const RETIRED_RECORD_WORK_FIELDS = RETIRED_SHARED_CHANGE_TRACKING_FIELDS;

export function rejectRemovedProtocolFlags(
  body: ProtocolRequestBody,
  removedFlags: readonly string[]
): void {
  const present = removedFlags.filter(flag => hasFlag(body, flag));
  if (present.length > 0) {
    throw new ApiError(
      400,
      `Unsupported protocol flag(s): ${present.join(', ')}`,
      undefined,
      'invalid_input'
    );
  }
}

export function rejectRemovedProtocolPayloadFields(
  payload: Record<string, unknown> | null | undefined,
  context: string,
  removedFields: readonly string[] = RETIRED_CHANGE_TRACKING_FIELDS
): void {
  const present = removedFields.filter(field =>
    Object.prototype.hasOwnProperty.call(payload ?? {}, field)
  );
  if (present.length > 0) {
    throw new ApiError(
      400,
      `Unsupported ${context} payload field(s): ${present.join(', ')}`,
      undefined,
      'invalid_input'
    );
  }
}

export type ArtifactInput = {
  type: string;
  label: string;
  content?: string | null;
  url?: string | null;
};

type DeliveryPayloadEnvelope = {
  summary?: string;
  artifacts?: ArtifactInput[];
  changeRationales?: ChangeRationaleInput[];
  verificationSummary?: string | null;
  followUpNotes?: string | null;
  payloadJson?: Record<string, unknown>;
};

/**
 * `--payload-json` is the portable delivery envelope. Individual current delivery
 * flags remain authoritative when both forms are present.
 */
export function parseDeliveryPayloadEnvelope(body: ProtocolRequestBody): DeliveryPayloadEnvelope {
  const input = parseJsonObjectInput(body, '--payload-json', '--payload-file', 'delivery payload');
  if (input === undefined) return {};

  const {
    summary,
    artifacts,
    changeRationales,
    verificationSummary,
    followUpNotes,
    ...payloadJson
  } = input;
  if (summary !== undefined && typeof summary !== 'string') {
    throw new ApiError(400, 'Delivery payload summary must be a string');
  }
  if (artifacts !== undefined && !Array.isArray(artifacts)) {
    throw new ApiError(400, 'Delivery payload artifacts must be an array');
  }
  if (changeRationales !== undefined && !Array.isArray(changeRationales)) {
    throw new ApiError(400, 'Delivery payload changeRationales must be an array');
  }
  if (
    verificationSummary !== undefined &&
    verificationSummary !== null &&
    typeof verificationSummary !== 'string'
  ) {
    throw new ApiError(400, 'Delivery payload verificationSummary must be a string or null');
  }
  if (followUpNotes !== undefined && followUpNotes !== null && typeof followUpNotes !== 'string') {
    throw new ApiError(400, 'Delivery payload followUpNotes must be a string or null');
  }
  return {
    ...(typeof summary === 'string' ? { summary } : {}),
    ...(Array.isArray(artifacts) ? { artifacts: artifacts as ArtifactInput[] } : {}),
    ...(Array.isArray(changeRationales)
      ? { changeRationales: changeRationales as ChangeRationaleInput[] }
      : {}),
    ...(verificationSummary === null || typeof verificationSummary === 'string'
      ? { verificationSummary }
      : {}),
    ...(followUpNotes === null || typeof followUpNotes === 'string' ? { followUpNotes } : {}),
    payloadJson
  };
}
