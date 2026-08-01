import { reducePath } from '../redact.js';

import {
  type DescribeInput,
  type Description,
  normalizeMarkers,
  type RiskMarker
} from './types.js';

/**
 * The read formatter — path only.
 *
 * Deliberately the shortest formatter in the module. A read carries no line ranges, no offsets,
 * and certainly no content, because none of that changes the decision and all of it widens what
 * we store. The one thing worth flagging is a read reaching outside the project, which is how a
 * session goes looking at `~/.aws/credentials`.
 */
export function describeRead({ input, projectRoot }: DescribeInput): Description {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const raw =
    (typeof record.file_path === 'string' && record.file_path) ||
    (typeof record.filePath === 'string' && record.filePath) ||
    (typeof record.path === 'string' && record.path) ||
    (typeof record.notebook_path === 'string' && record.notebook_path) ||
    null;
  const path = reducePath(raw, projectRoot);

  const markers: (RiskMarker | false | undefined)[] = [
    path?.outsideProject && 'outside-project-directory',
    path?.nonAscii && 'non-ascii-path'
  ];
  if (
    path &&
    /(^|\/)(\.env|\.npmrc|\.netrc|id_rsa|id_ed25519|credentials)(\.|$)/.test(path.display)
  ) {
    markers.push('secret-adjacent');
  }

  return {
    action: 'Read a file',
    subject: path?.display ?? null,
    detail: null,
    riskMarkers: normalizeMarkers(markers)
  };
}
