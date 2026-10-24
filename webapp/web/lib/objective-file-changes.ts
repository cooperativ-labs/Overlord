import {
  CAPTURE_WARNING_MESSAGES,
  type CaptureSessionDto,
  type FileChangeSource,
  type ObjectiveFileChangesDto
} from '../../shared/contract.ts';

export type FileChangeSourceLabel = 'Native' | 'Declared' | 'Unknown';

/**
 * Display label for a row's provenance. Native means at least one successful
 * native connector observation; Declared means only an explicit agent
 * declaration; null is historical provenance nobody recorded, never Native.
 */
export function fileChangeSourceLabel(source: FileChangeSource | null): FileChangeSourceLabel {
  if (source === 'declared_edit') return 'Native';
  if (source === 'agent_declared') return 'Declared';
  return 'Unknown';
}

/** Last path segment; the DTO carries no file name of its own. */
export function fileChangeBasename(filePath: string): string {
  const trimmed = filePath.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** Directory part of a relative path, or `''` for a top-level file. */
export function fileChangeDirname(filePath: string): string {
  const trimmed = filePath.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index === -1 ? '' : trimmed.slice(0, index);
}

/**
 * What an objective's file list can honestly claim:
 *
 * - `listed` — synchronized paths exist (possibly truncated, possibly with gaps).
 * - `none_captured` — capture sessions exist but no path was synchronized. That is
 *   not proof nothing changed; warnings say how far tracking can be trusted.
 * - `unavailable` — no capture session and no path: tracking never ran for this
 *   objective (record-work without paths, hosted agents, pre-tracking history).
 */
export type ObjectiveFileEvidenceState = 'listed' | 'none_captured' | 'unavailable';

export type ObjectiveFileEvidenceSummary = {
  state: ObjectiveFileEvidenceState;
  /** Distinct objective warnings, in contract order of first appearance. */
  warnings: string[];
  /** `Showing 200 of 512 files`, or null when the list is complete. */
  truncationNotice: string | null;
};

export function summarizeObjectiveFileEvidence(
  dto: Pick<ObjectiveFileChangesDto, 'items' | 'total' | 'truncated' | 'capture'>
): ObjectiveFileEvidenceSummary {
  const state: ObjectiveFileEvidenceState =
    dto.items.length > 0
      ? 'listed'
      : dto.capture.sessions.length > 0
        ? 'none_captured'
        : 'unavailable';
  const warnings = [...new Set(dto.capture.warnings.map(code => CAPTURE_WARNING_MESSAGES[code]))];
  const truncationNotice =
    dto.truncated || dto.total > dto.items.length
      ? `Showing ${dto.items.length} of ${dto.total} files`
      : null;
  return { state, warnings, truncationNotice };
}

/** One line per session for the on-demand capture details. */
export function describeCaptureSession(session: CaptureSessionDto): string {
  const binding =
    session.bindingState === 'bound'
      ? 'tracking configured'
      : session.bindingState === 'unbound'
        ? 'tracking not active'
        : 'tracking availability unknown';
  const callback = session.callbackObservedAt ? 'callback observed' : 'no callback observed';
  const health = session.health.map(entry => entry.code.replaceAll('_', ' '));
  return [binding, callback, ...health].join(' · ');
}
