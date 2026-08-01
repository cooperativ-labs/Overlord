import { readActiveMissionPointer as readMissionPointer } from '../active-mission.js';
import { resolveNativeSessionId } from '../native-session.js';

import { HARNESS_DESCRIPTORS } from './catalog.generated.js';

/**
 * Local, offline report of what this working directory's agent session is bound to.
 *
 * A missing binding fails as silence — the feed simply stays empty — so `ovld doctor` has to
 * be able to say which integration is installed, at what scope, and which mission the current
 * native session is bound to. This module is that reporting path and nothing more.
 *
 * Two rules shape it:
 *
 *  - **It performs no network I/O**, ever, and none for an unbound session in particular.
 *    An unrelated session must be able to run `doctor` without any request being made on its
 *    behalf.
 *  - **The working directory is a lookup hint, never an authority.** The cwd pointer answers
 *    "which project/mission is this checkout on?", which cannot answer "which session is
 *    this?". It may help LOCATE an existing local binding; it can never create one, and it
 *    never authorizes an event. Authorization and mission scope come from the verified
 *    channel/session credential, and a native session id is a correlation alias only.
 */

export type AgentSessionBindingReport = {
  bound: boolean;
  missionId: string | null;
  displayId: string | null;
  nativeSessionId: string | null;
  nativeSessionAgent: string | null;
  detail: string;
};

export function readActiveMissionPointer({
  workingDirectory,
  env = process.env
}: {
  workingDirectory: string;
  env?: NodeJS.ProcessEnv;
}): AgentSessionBindingReport {
  const pointer = readMissionPointer(workingDirectory);
  if (!pointer) {
    return {
      bound: false,
      missionId: null,
      displayId: null,
      nativeSessionId: null,
      nativeSessionAgent: null,
      detail:
        'no mission attached in this directory — an unbound session is silent by design ' +
        '(no request, no event, no network call)'
    };
  }

  // Correlation only: find whether any known adapter has cached a native session id for this
  // (directory, mission). A cache hit is a lookup alias, not a grant of scope.
  let nativeSessionId: string | null = null;
  let nativeSessionAgent: string | null = null;
  for (const descriptor of HARNESS_DESCRIPTORS) {
    const resolved = resolveNativeSessionId({
      agent: descriptor.adapter,
      missionId: pointer.missionId,
      workingDirectory,
      env
    });
    if (typeof resolved === 'string' && resolved.trim() !== '') {
      nativeSessionId = resolved.trim();
      nativeSessionAgent = descriptor.adapter;
      break;
    }
  }

  const missionLabel = pointer.displayId || pointer.missionId;
  return {
    bound: true,
    missionId: pointer.missionId,
    displayId: pointer.displayId || null,
    nativeSessionId,
    nativeSessionAgent,
    detail: nativeSessionId
      ? `attached to ${missionLabel}; native session ${nativeSessionAgent}:${nativeSessionId.slice(0, 12)} ` +
        '(correlation alias only — the channel credential is the authority)'
      : `attached to ${missionLabel}; no native session id correlated yet`
  };
}
