import { missionDisplayIdFromObjectiveRef } from '@overlord/contract';

import { parseArgs } from '../args.js';
import { CliError } from '../errors.js';
import { writeNativeSessionId } from '../native-session.js';
import { printJson } from '../output.js';

import { resolveAgentSessionScope } from './bind.js';
import { createChannelClient } from './client.js';
import {
  AGENT_SESSION_CAPABILITY_IDS,
  findHarnessDescriptor,
  HARNESS_CAPABILITY_TIER_NAMES,
  HARNESS_CATALOG_DIGEST,
  HARNESS_DESCRIPTORS,
  type HarnessDescriptor
} from './descriptor.js';
import { runAgentSessionEvent } from './event.js';
import { confirmInboxEmission, runAgentSessionInbox } from './inbox.js';
import { runAgentSessionRequest } from './request.js';

/**
 * `ovld agent-session` — the local agent-session runtime surface.
 *
 * Phase 0A ships exactly one subcommand: the human-facing `capabilities` reader. It exists so
 * an agent working in a terminal can ask what is possible for a harness without reading files,
 * which is the fastest path to the answer and therefore the one that will actually get used.
 *
 * It is a pure local read of the compiled catalog: no network call, no filesystem write, no
 * subprocess. The adapter runtime subcommands (`event`, `request`, `inbox`, `bind`) land with
 * the channel bootstrap in Phase 0B — they require a scoped channel credential, and offering
 * their presentation before their authorization exists would be the wrong order.
 */

const STATUS_MARK: Record<string, string> = {
  supported: 'ok  ',
  unsupported: 'no  ',
  'not-implemented': 'todo',
  unverified: '??  '
};

function describeEvidence(entry: {
  status: string;
  reason: string | null;
  evidenceRef: string | null;
  trackedAs: string | null;
}): string {
  if (entry.status === 'unsupported') {
    const reason = (entry.reason ?? '').replace(/\s+/g, ' ').trim();
    return `${reason}${entry.evidenceRef ? ` [evidence: ${entry.evidenceRef}]` : ''}`;
  }
  if (entry.trackedAs) return `tracked as ${entry.trackedAs}`;
  return '';
}

function printDescriptor(descriptor: HarnessDescriptor): void {
  const tierName = HARNESS_CAPABILITY_TIER_NAMES[descriptor.capabilityTier] ?? 'Unknown';
  console.log(`${descriptor.harness.name} (${descriptor.adapter})`);
  console.log(
    `  shape ${descriptor.integrationShape} · tier ${descriptor.capabilityTier} (${tierName}) · ` +
      `codec ${descriptor.codec}`
  );
  console.log(
    `  harness version verified: ${descriptor.harness.verifiedVersion ?? 'none'}` +
      (descriptor.harness.versionRange ? ` · range ${descriptor.harness.versionRange}` : '')
  );
  console.log(
    `  binding: ${descriptor.binding.status} (${descriptor.binding.source}` +
      `${descriptor.binding.field ? ` ${descriptor.binding.field}` : ''})`
  );
  console.log(`  decision hold: ${descriptor.decisionHold.status}`);
  console.log(`  descriptor digest: ${descriptor.descriptorDigest.slice(0, 16)}`);
  console.log('');
  for (const id of AGENT_SESSION_CAPABILITY_IDS) {
    const entry = descriptor.capabilities[id];
    const evidence = describeEvidence(entry);
    console.log(
      `  ${STATUS_MARK[entry.status] ?? '    '} ${id.padEnd(26)} ${entry.native ?? '—'}` +
        (evidence ? `\n       ${evidence}` : '')
    );
  }
  const openHazards = descriptor.hazards.filter(
    hazard => hazard.mitigation !== 'implemented' || hazard.verification !== 'verified'
  );
  if (openHazards.length > 0) {
    console.log('');
    console.log('  open hazards:');
    for (const hazard of openHazards) {
      console.log(
        `    ${hazard.severity.padEnd(6)} ${hazard.id} (${hazard.verification}, mitigation ` +
          `${hazard.mitigation}${hazard.trackedAs ? `, tracked as ${hazard.trackedAs}` : ''})`
      );
    }
  }
  console.log('');
  console.log(
    '  supported = proven by a passing fixture. unsupported = the harness cannot do it; do not'
  );
  console.log(
    '  attempt it. not-implemented = buildable and unbuilt; that is your work. unverified = find'
  );
  console.log('  out first, then flip the status in the same change that adds the fixture.');
  console.log(
    '  This is the static catalog maximum; a live session may be downgraded below it by harness'
  );
  console.log('  version, connector drift, project policy, or runtime probes.');
}

function printSummary(): void {
  console.log('Harness agent-session capabilities (compiled catalog)');
  console.log('');
  console.log('  adapter       shape         tier                binding          decision hold');
  for (const descriptor of HARNESS_DESCRIPTORS) {
    const tierName = HARNESS_CAPABILITY_TIER_NAMES[descriptor.capabilityTier] ?? '';
    console.log(
      `  ${descriptor.adapter.padEnd(13)} ${descriptor.integrationShape.padEnd(13)} ` +
        `${`${descriptor.capabilityTier} ${tierName}`.padEnd(19)} ` +
        `${descriptor.binding.status.padEnd(16)} ${descriptor.decisionHold.status}`
    );
  }
  console.log('');
  console.log(`  catalog digest: ${HARNESS_CATALOG_DIGEST.slice(0, 16)}`);
  console.log('  Run `ovld agent-session capabilities <agent>` for one harness in full.');
}

/**
 * `ovld agent-session bind` — record a harness session id against this process's channel.
 *
 * What this command is *not* is as important as what it is. It does not create a binding, and
 * it cannot: a native session id is a correlation alias, and possession of one confers nothing.
 * The authority is the channel credential already present in this process's environment (or its
 * owner-only local cache). Without one, this command writes the local correlation entry — which
 * is inert on its own — and reports honestly that there was no channel to bind to.
 *
 * That asymmetry is the point. An adapter that can read a hook payload can read a session id;
 * if that were sufficient to bind, any process on the machine could attach itself to a mission
 * it was never launched for.
 */
async function runBindCommand({
  args,
  primaryCommand
}: {
  args: string[];
  primaryCommand: string;
}): Promise<void> {
  const parsed = parseArgs(args);
  const agent = parsed.flags.get('--agent');
  const nativeSessionId = parsed.flags.get('--native-session-id');
  const missionFlag = parsed.flags.get('--mission-id');
  const objectiveFlag = parsed.flags.get('--objective-id');
  const objectiveId =
    (typeof objectiveFlag === 'string' && objectiveFlag.trim()
      ? objectiveFlag.trim()
      : undefined) ?? process.env.OVERLORD_OBJECTIVE_ID;
  // The correlation alias is keyed per objective, so a bind that names only the
  // objective still resolves its mission: an objective display id spells it.
  const missionId =
    (typeof missionFlag === 'string' ? missionFlag : undefined) ??
    missionDisplayIdFromObjectiveRef(objectiveId) ??
    process.env.MISSION_ID ??
    process.env.OVERLORD_MISSION_ID ??
    null;

  if (typeof agent !== 'string' || typeof nativeSessionId !== 'string') {
    throw new CliError({
      message:
        `Usage: ${primaryCommand} agent-session bind --agent <key> ` +
        `--native-session-id <id> [--mission-id <id>] [--objective-id <id>]`
    });
  }

  // The local correlation entry is written whenever a mission is known, channel or not: it is
  // the same alias the connectors' prompt hooks already maintain, and it is what lets a later
  // `ovld doctor` say which harness conversation this checkout is running.
  if (missionId) {
    writeNativeSessionId({
      agent,
      missionId,
      externalSessionId: nativeSessionId,
      objectiveId
    });
  }

  const scope = resolveAgentSessionScope({ agent, missionId, env: process.env });
  if (!scope) {
    printJson({
      bound: false,
      correlated: Boolean(missionId),
      reason: 'no_session_channel_credential',
      detail:
        'This session has no channel credential, so there is nothing to bind to. A native ' +
        'session id is a correlation alias and never an authority.'
    });
    return;
  }

  const baseUrl = process.env.OVERLORD_BACKEND_URL?.trim();
  if (!baseUrl) {
    printJson({ bound: false, correlated: Boolean(missionId), reason: 'no_backend_url' });
    return;
  }

  const client = createChannelClient({
    baseUrl,
    channelId: scope.channelId,
    token: scope.token
  });
  // Heartbeat carries the alias: the same call that proves the channel is alive records what
  // the harness calls this conversation. One round trip, and no separate binding endpoint that
  // a native id could be presented to on its own.
  const result = await client.post('/heartbeat', { nativeSessionId });
  printJson({
    bound: result.ok,
    correlated: Boolean(missionId),
    channelId: scope.channelId,
    ...(result.ok ? {} : { reason: result.reason })
  });
}

/**
 * `ovld agent-session event` — the push entry point every callback adapter shares.
 *
 * It prints nothing, ever, and exits 0 on every path including failure. That is the contract
 * with the harness: an observational hook that writes to stderr has produced output the user
 * did not ask for, in a context where they cannot turn it off. The outcome is available to
 * tests through the exported runtime function, which is where it belongs.
 */
async function runEventCommand({
  args,
  primaryCommand
}: {
  args: string[];
  primaryCommand: string;
}): Promise<void> {
  const parsed = parseArgs(args);
  const agent = parsed.flags.get('--agent');
  const payloadFile = parsed.flags.get('--payload-file');
  if (typeof agent !== 'string') {
    throw new CliError({
      message: `Usage: ${primaryCommand} agent-session event --agent <key> --payload-file -`
    });
  }
  await runAgentSessionEvent({
    agent,
    payloadFile: typeof payloadFile === 'string' ? payloadFile : null
  });
}

/**
 * `ovld agent-session sidecar` — the push entry point for control-plane harnesses.
 *
 * The fifth adapter subcommand, and the test for whether it belongs is the same one the plan
 * sets for the others: adding a *sixth harness* must add zero subcommands. It does — a new
 * control-plane adapter supplies a codec and a descriptor, and this command drives it unchanged.
 * What would have failed the test is `ovld agent-session opencode`.
 */
async function runSidecarCommand({
  args,
  primaryCommand
}: {
  args: string[];
  primaryCommand: string;
}): Promise<void> {
  const parsed = parseArgs(args);
  const agent = parsed.flags.get('--agent');
  const portFlag = parsed.flags.get('--port');
  const port = typeof portFlag === 'string' ? Number.parseInt(portFlag, 10) : Number.NaN;
  if (typeof agent !== 'string' || !Number.isInteger(port) || port <= 0) {
    throw new CliError({
      message: `Usage: ${primaryCommand} agent-session sidecar --agent <key> --port <port>`
    });
  }
  const { runSidecar } = await import('./sidecar.js');
  const result = await runSidecar({ agent, port });
  printJson(result);
}

async function runRequestCommand({
  args,
  primaryCommand
}: {
  args: string[];
  primaryCommand: string;
}): Promise<void> {
  const parsed = parseArgs(args);
  const agent = parsed.flags.get('--agent');
  const payloadFile = parsed.flags.get('--payload-file');
  if (typeof agent !== 'string') {
    throw new CliError({
      message: `Usage: ${primaryCommand} agent-session request --agent <key> --payload-file -`
    });
  }
  const decision = await runAgentSessionRequest({
    agent,
    payloadFile: typeof payloadFile === 'string' ? payloadFile : null
  });
  if (decision) process.stdout.write(decision);
}

/**
 * `ovld agent-session inbox` — claim one pending injection and emit it natively.
 *
 * Stdout/stderr/exit are harness-specific (see inbox.ts). The process exit code is the
 * harness contract — especially Claude asyncRewake's exit 2 — so callers must not wrap this
 * in a shell that normalizes status.
 */
async function runInboxCommand({
  args,
  primaryCommand
}: {
  args: string[];
  primaryCommand: string;
}): Promise<void> {
  const parsed = parseArgs(args);
  const agent = parsed.flags.get('--agent');
  if (typeof agent !== 'string') {
    throw new CliError({
      message: `Usage: ${primaryCommand} agent-session inbox --agent <key> --payload-file -`
    });
  }
  const confirmId = parsed.flags.get('--confirm');
  const leaseId = parsed.flags.get('--lease-id');
  if (typeof confirmId === 'string') {
    if (typeof leaseId !== 'string') {
      throw new CliError({
        message: `Usage: ${primaryCommand} agent-session inbox --agent <key> --confirm <input-id> --lease-id <lease>`
      });
    }
    const confirmed = await confirmInboxEmission({ agent, inputId: confirmId, leaseId });
    if (confirmed.report === 'Delivered')
      printJson({ report: confirmed.report, inputId: confirmId });
    return;
  }
  const waitFlag = parsed.flags.get('--wait-ms');
  const waitMs =
    typeof waitFlag === 'string' && Number.isFinite(Number(waitFlag)) ? Number(waitFlag) : 0;
  // Hooks pass --payload-file - and stream the native event on stdin. Extension callers
  // (Pi) invoke without a payload file and must not block on an empty stdin pipe.
  const readsStdin = parsed.flags.has('--payload-file');
  const result = await runAgentSessionInbox({
    agent,
    waitMs,
    payloadRaw: readsStdin ? undefined : '{}'
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

export async function runAgentSessionCommand({
  subcommand,
  args,
  primaryCommand
}: {
  subcommand: string | undefined;
  args: string[];
  primaryCommand: string;
}): Promise<void> {
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    console.log(`Usage: ${primaryCommand} agent-session <command>`);
    console.log('');
    console.log(
      '  capabilities [<agent>] [--json]  Print the fixture-backed capability descriptor.'
    );
    console.log(
      '  bind --agent <key> --native-session-id <id> [--mission-id <id>] [--objective-id <id>]'
    );
    console.log(
      '                                   Correlate a harness session id with this channel.'
    );
    console.log('  event --agent <key> --payload-file -');
    console.log(
      '                                   Push one native harness event. Silent, never blocks.'
    );
    console.log('  request --agent <key> --payload-file -');
    console.log(
      '                                   Wait for a remote decision or defer to the harness.'
    );
    console.log('  inbox --agent <key> --payload-file -');
    console.log(
      '                                   Claim one pending instruction and emit it natively.'
    );
    console.log('  sidecar --agent <key> --port <port>');
    console.log(
      '                                   Drive a control-plane harness event stream (Shape C).'
    );
    console.log('');
    console.log('  All adapter runtime commands require a scoped session channel credential.');
    return;
  }

  if (subcommand === 'bind') {
    await runBindCommand({ args, primaryCommand });
    return;
  }

  if (subcommand === 'event') {
    await runEventCommand({ args, primaryCommand });
    return;
  }

  if (subcommand === 'sidecar') {
    await runSidecarCommand({ args, primaryCommand });
    return;
  }

  if (subcommand === 'request') {
    await runRequestCommand({ args, primaryCommand });
    return;
  }

  if (subcommand === 'inbox') {
    await runInboxCommand({ args, primaryCommand });
    return;
  }

  if (subcommand !== 'capabilities') {
    throw new CliError({
      message:
        `Unknown agent-session subcommand: ${subcommand}\n` +
        `Usage: ${primaryCommand} agent-session <capabilities|bind|event|request|inbox|sidecar>`
    });
  }

  const parsed = parseArgs(args);
  const json = parsed.flags.get('--json') !== undefined;
  const agent = parsed.positional[0];

  if (!agent) {
    if (json) {
      printJson({
        catalogDigest: HARNESS_CATALOG_DIGEST,
        capabilityIds: AGENT_SESSION_CAPABILITY_IDS,
        tierNames: HARNESS_CAPABILITY_TIER_NAMES,
        descriptors: HARNESS_DESCRIPTORS
      });
      return;
    }
    printSummary();
    return;
  }

  const descriptor = findHarnessDescriptor(agent.toLowerCase());
  if (!descriptor) {
    throw new CliError({
      message:
        `No harness capability descriptor for "${agent}".\n` +
        `Known adapters: ${HARNESS_DESCRIPTORS.map(entry => entry.adapter).join(', ')}`
    });
  }

  if (json) {
    printJson({ catalogDigest: HARNESS_CATALOG_DIGEST, descriptor });
    return;
  }
  printDescriptor(descriptor);
}
