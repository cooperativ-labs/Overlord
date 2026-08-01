import { byteLength, reducePath } from '../redact.js';

import {
  type DescribeInput,
  type Description,
  normalizeMarkers,
  type RiskMarker
} from './types.js';

/**
 * The write/edit formatter.
 *
 * One rule dominates: **never the content.** A file being written is frequently the most
 * sensitive thing in the session — a `.env`, a private key, a customer export — and the card is
 * a decision surface, not an audit surface. Path, size, and create-versus-overwrite are enough
 * to decide; the content is available in the terminal, where it never left the machine.
 *
 * `create-vs-overwrite` earns its place because it is the difference between an action that
 * loses nothing and one that destroys work. Harnesses do not label it consistently, so it is
 * inferred from the shape of the input: an edit with an `old_string`/`oldText` is by
 * construction an overwrite of something that existed.
 */

function readPath(record: Record<string, unknown>): unknown {
  for (const key of ['file_path', 'filePath', 'path', 'notebook_path', 'notebookPath', 'target']) {
    if (typeof record[key] === 'string') return record[key];
  }
  return null;
}

function readContent(record: Record<string, unknown>): unknown {
  for (const key of ['content', 'contents', 'new_string', 'newText', 'new_source', 'text']) {
    if (typeof record[key] === 'string') return record[key];
  }
  return null;
}

function isOverwrite(record: Record<string, unknown>): boolean {
  for (const key of ['old_string', 'oldText', 'old_source', 'replace_all', 'edits']) {
    if (record[key] !== undefined && record[key] !== null) return true;
  }
  return false;
}

export function describeWrite({ input, projectRoot }: DescribeInput): Description {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const path = reducePath(readPath(record), projectRoot);
  const overwrite = isOverwrite(record);
  const bytes = byteLength(readContent(record));

  const markers: (RiskMarker | false | undefined)[] = [
    overwrite && 'overwrites-existing',
    path?.outsideProject && 'outside-project-directory',
    path?.nonAscii && 'non-ascii-path'
  ];

  // Editing a credential file is worth flagging even though we show nothing from inside it:
  // the path alone is the signal, and the path is all we have.
  if (
    path &&
    /(^|\/)(\.env|\.npmrc|\.netrc|id_rsa|id_ed25519|credentials)(\.|$)/.test(path.display)
  ) {
    markers.push('secret-adjacent');
  }

  const detail =
    bytes === null
      ? overwrite
        ? 'replacing existing text'
        : null
      : `${bytes} byte${bytes === 1 ? '' : 's'}${overwrite ? ', replacing existing text' : ''}`;

  return {
    action: overwrite ? 'Overwrite a file' : 'Write a file',
    subject: path?.display ?? null,
    detail,
    riskMarkers: normalizeMarkers(markers)
  };
}
