#!/usr/bin/env node
/**
 * Deterministic generator for connector harness-capability artifacts.
 *
 * One hand-authored source per adapter — `connectors/adapters/<agent>/harness-capabilities.yaml` —
 * validated against contract/harness-capabilities.schema.yaml, proven by executable fixtures,
 * and projected into every downstream artifact:
 *
 *   connectors/adapters/<agent>/CAPABILITIES.md   per-adapter page (do-not-edit banner)
 *   connectors/HARNESS-MATRIX.md                  cross-adapter matrix
 *   cli/src/agent-session/catalog.generated.ts    compiled catalog the runtime reads
 *   connectors/adapters/<agent>/conformance-manifest.yaml
 *                                                 the DEPRECATED hook-named capability
 *                                                 projection plus integrationShape,
 *                                                 capabilityTier, and the descriptor digest
 *
 * Nothing here is hand-maintained prose: a matrix that is 60% accurate is worse than none,
 * because it is trusted. The tier is DERIVED — never authored — and a `supported` claim whose
 * fixture does not execute and pass is a hard failure, not a claim.
 *
 * Usage:
 *   node scripts/generate-harness-capabilities.mjs            # write
 *   node scripts/generate-harness-capabilities.mjs --check    # CI drift check (writes nothing)
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { runFixture } from './harness-capability-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adaptersDir = path.join(repoRoot, 'connectors', 'adapters');
const extensionPointsPath = path.join(repoRoot, 'contract', 'extension-points.yaml');

const CAPABILITY_IDS = [
  'observe.prompt',
  'observe.toolCall',
  'observe.toolResult',
  'observe.fileEdit',
  'observe.sessionLifecycle',
  'decide.shell',
  'decide.mcp',
  'decide.fileWrite',
  'decide.anyTool',
  'decide.universal',
  'answer.structuredQuestion',
  'answer.persistentAllow',
  'inject.midTurn',
  'inject.turnBoundary',
  'inject.nextTurn',
  'terminal.concurrentAnswer',
  'terminal.statusSurface'
];
const STATUSES = ['supported', 'unsupported', 'not-implemented', 'unverified'];
const INTEGRATION_SHAPES = ['callback', 'extension', 'controlPlane'];
const TIER_NAMES = ['Unsupported', 'Observational', 'Answerable', 'Conversational'];
const DO_NOT_EDIT =
  '<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->';

function readYaml(filePath) {
  return parseYaml(readFileSync(filePath, 'utf8'));
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function listAdapters() {
  return readdirSync(adaptersDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

// ── Validation ────────────────────────────────────────────────────────────────
//
// The schema file is the normative document; this is its executable enforcement,
// written out longhand so a failure names the exact rule that was broken.

function validateStatusEvidence({ label, node, errors }) {
  if (!STATUSES.includes(node.status)) {
    errors.push(`${label}: status must be one of ${STATUSES.join(' | ')} (got ${node.status})`);
    return;
  }
  if (node.status === 'unsupported' && (!node.reason || !node.evidenceRef)) {
    errors.push(`${label}: unsupported requires both reason and evidenceRef`);
  }
  if ((node.status === 'not-implemented' || node.status === 'unverified') && !node.trackedAs) {
    errors.push(`${label}: ${node.status} requires trackedAs`);
  }
  if (node.status === 'supported' && node.evidenceRef) {
    errors.push(
      `${label}: promoting a status out of unsupported must replace evidenceRef with executable fixtures`
    );
  }
}

function validateDescriptor({ adapter, descriptor, approved, errors }) {
  const at = field => `${adapter}/harness-capabilities.yaml ${field}`;

  if (descriptor.schemaVersion !== 1) errors.push(at('schemaVersion') + ': must be 1');
  if (descriptor.adapter !== adapter) {
    errors.push(at('adapter') + `: must equal the directory name (${adapter})`);
  }
  if (!descriptor.codec) errors.push(at('codec') + ': required');
  if (!INTEGRATION_SHAPES.includes(descriptor.integrationShape)) {
    errors.push(at('integrationShape') + `: must be one of ${INTEGRATION_SHAPES.join(' | ')}`);
  }
  if (!descriptor.harness?.name || !descriptor.harness?.versionScheme) {
    errors.push(at('harness') + ': name and versionScheme are required');
  }

  validateStatusEvidence({ label: at('binding'), node: descriptor.binding ?? {}, errors });
  validateStatusEvidence({
    label: at('decisionHold'),
    node: descriptor.decisionHold ?? {},
    errors
  });

  const capabilities = descriptor.capabilities ?? {};
  for (const id of Object.keys(capabilities)) {
    if (!CAPABILITY_IDS.includes(id)) {
      errors.push(at(`capabilities.${id}`) + ': not in the closed capability-id vocabulary');
    }
  }
  for (const id of CAPABILITY_IDS) {
    const node = capabilities[id];
    if (!node) {
      errors.push(
        at(`capabilities.${id}`) +
          ': missing. Every capability id must be declared — an omission reads as a claim.'
      );
      continue;
    }
    validateStatusEvidence({ label: at(`capabilities.${id}`), node, errors });
    if (node.status === 'supported' && (!node.native || !(node.fixtures?.length > 0))) {
      errors.push(
        at(`capabilities.${id}`) + ': supported requires native and at least one fixture'
      );
    }
  }

  for (const hazard of descriptor.hazards ?? []) {
    if (hazard.mitigation === 'implemented' && !hazard.fixture) {
      errors.push(at(`hazards.${hazard.id}`) + ': mitigation implemented requires a fixture');
    }
    if (
      (hazard.verification === 'unverified' || hazard.mitigation === 'required') &&
      !hazard.trackedAs
    ) {
      errors.push(
        at(`hazards.${hazard.id}`) + ': unverified or required-mitigation hazards need trackedAs'
      );
    }
  }

  if (!descriptor.unboundSessionFixture) {
    errors.push(
      at('unboundSessionFixture') +
        ': required. A negative test proving an unbound session is untouched is mandatory per adapter.'
    );
  }

  // Legacy projection inputs must stay inside the approved (deprecated) closed sets, and the
  // hook-named interaction flags may only be emitted when this descriptor actually backs them.
  const legacyCapabilities = descriptor.legacy?.capabilities ?? [];
  const legacyHookTypes = descriptor.legacy?.hookTypes ?? [];
  for (const flag of legacyCapabilities) {
    if (!approved.capabilities.includes(flag)) {
      errors.push(at(`legacy.capabilities`) + `: ${flag} is not in approvedConnectorCapabilities`);
    }
  }
  for (const hookType of legacyHookTypes) {
    if (!approved.hookTypes.includes(hookType)) {
      errors.push(at(`legacy.hookTypes`) + `: ${hookType} is not in approvedHookTypes`);
    }
  }
  const claimsNative = nativeName =>
    Object.values(capabilities).some(
      node => node.native === nativeName && node.status !== 'unsupported'
    );
  if (legacyCapabilities.includes('permissionHook')) {
    if (!legacyHookTypes.includes('PermissionRequest') || !claimsNative('PermissionRequest')) {
      errors.push(
        at('legacy.capabilities') +
          ': permissionHook may only be declared when the descriptor declares a non-unsupported' +
          ' capability on the native PermissionRequest event AND hookTypes includes PermissionRequest'
      );
    }
  }
  if (legacyHookTypes.includes('PermissionRequest') && !claimsNative('PermissionRequest')) {
    errors.push(
      at('legacy.hookTypes') +
        ': PermissionRequest may not be declared when no capability rides on that native event'
    );
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function collectFixtureRefs(descriptor) {
  const refs = new Set();
  if (descriptor.binding?.fixture) refs.add(descriptor.binding.fixture);
  if (descriptor.decisionHold?.fixture) refs.add(descriptor.decisionHold.fixture);
  for (const node of Object.values(descriptor.capabilities ?? {})) {
    for (const fixture of node.fixtures ?? []) refs.add(fixture);
  }
  for (const hazard of descriptor.hazards ?? []) {
    if (hazard.fixture) refs.add(hazard.fixture);
  }
  for (const key of ['allowFixture', 'denyFixture', 'deferFixture']) {
    if (descriptor.decisionShape?.[key]) refs.add(descriptor.decisionShape[key]);
  }
  if (descriptor.unboundSessionFixture) refs.add(descriptor.unboundSessionFixture);
  return [...refs].sort();
}

function runAdapterFixtures({ adapter, descriptor, errors }) {
  const results = {};
  for (const ref of collectFixtureRefs(descriptor)) {
    const fixturePath = path.join(adaptersDir, adapter, ref);
    if (!existsSync(fixturePath)) {
      errors.push(`${adapter}: fixture not found: ${ref}`);
      results[ref] = { ok: false };
      continue;
    }
    const result = runFixture({ fixturePath, repoRoot });
    results[ref] = result;
    if (!result.ok) {
      for (const failure of result.failures) errors.push(`${adapter}: fixture ${ref}: ${failure}`);
    }
  }

  // The unbound-session negative test is allowed to RECORD side effects that exist today, but
  // only if the descriptor also declares the hazard that tracks removing them. Silence about a
  // recorded side effect would let the negative test read as clean when it is not.
  const unbound = descriptor.unboundSessionFixture;
  if (unbound && existsSync(path.join(adaptersDir, adapter, unbound))) {
    const fixture = JSON.parse(readFileSync(path.join(adaptersDir, adapter, unbound), 'utf8'));
    const sideEffects =
      (fixture.expect?.sandboxWrites?.length ?? 0) > 0 ||
      (fixture.expect?.cliInvocations?.length ?? 0) > 0;
    const declared = (descriptor.hazards ?? []).some(
      hazard => hazard.id === 'unbound-session-side-effects'
    );
    if (sideEffects && !declared) {
      errors.push(
        `${adapter}: the unbound-session fixture records a write or CLI invocation, so the descriptor` +
          ` must declare the \`unbound-session-side-effects\` hazard with a tracker`
      );
    }
  }
  if (descriptor.integrationShape !== 'controlPlane') {
    for (const [id, node] of Object.entries(descriptor.capabilities ?? {})) {
      if (!id.startsWith('decide.') || node.status !== 'supported') continue;
      const provesDecision = (node.fixtures ?? []).some(
        ref => results[ref]?.kind === 'decision-codec'
      );
      if (!provesDecision) {
        errors.push(
          `${adapter}: ${id} is supported but has no passing decision-codec fixture; ` +
            'a native-payload shape fixture does not prove exact response bytes'
        );
      }
    }
  }
  return results;
}

// ── Tier derivation ───────────────────────────────────────────────────────────
//
// No tier is authored. A connector's tier is the highest one whose every requirement it
// demonstrates with a passing fixture; claimed-but-unproven is worse than absent, because the
// UI renders controls that do nothing.

function deriveTier({ descriptor }) {
  const capabilities = descriptor.capabilities ?? {};
  const supported = id => capabilities[id]?.status === 'supported';
  const anySupported = prefix => CAPABILITY_IDS.some(id => id.startsWith(prefix) && supported(id));

  const bound = descriptor.binding?.status === 'supported';
  if (!bound || !anySupported('observe.')) return 0;

  // Shape C is a peer on the harness's own event bus: there is no held callback, so a decision
  // hold is not a prerequisite for answering.
  const canHold =
    descriptor.integrationShape === 'controlPlane' ||
    descriptor.decisionHold?.status === 'supported';
  const canDecide = anySupported('decide.') || supported('answer.structuredQuestion');
  if (!canHold || !canDecide) return 1;

  if (!anySupported('inject.')) return 2;
  return 3;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const STATUS_LABEL = {
  supported: '✅ supported',
  unsupported: '⛔ unsupported',
  'not-implemented': '🚧 not-implemented',
  unverified: '❓ unverified'
};

function renderStatusCell(node) {
  if (!node) return '❓ unverified';
  return STATUS_LABEL[node.status] ?? node.status;
}

function renderEvidence(node) {
  if (!node) return '';
  if (node.status === 'unsupported')
    return `${node.reason ?? ''} (evidence: \`${node.evidenceRef}\`)`;
  if (node.status === 'supported') {
    const fixtures = node.fixtures ?? (node.fixture ? [node.fixture] : []);
    return `fixtures: ${fixtures.map(f => `\`${f}\``).join(', ')}`;
  }
  return node.trackedAs ? `tracked as \`${node.trackedAs}\`` : '';
}

function renderAdapterPage({ adapter, descriptor, tier, digest }) {
  const lines = [];
  lines.push(DO_NOT_EDIT, '');
  lines.push(`# ${descriptor.harness.name} — Overlord agent-session capabilities`, '');
  lines.push(
    `**Adapter** \`${adapter}\` · **Codec** \`${descriptor.codec}\` · ` +
      `**Integration shape** \`${descriptor.integrationShape}\` · ` +
      `**Capability tier** ${tier} (${TIER_NAMES[tier]})`,
    ''
  );
  const verified = descriptor.harness.verifiedVersion
    ? `\`${descriptor.harness.verifiedVersion}\``
    : '_not verified_';
  lines.push(
    `**Harness version verified** ${verified}` +
      (descriptor.harness.versionRange
        ? ` · **range** \`${descriptor.harness.versionRange}\``
        : '') +
      ` · **scheme** \`${descriptor.harness.versionScheme}\``,
    ''
  );
  lines.push(`**Descriptor digest** \`${digest}\``, '');
  lines.push(
    '> The tier is derived from passing fixtures, never authored. `unsupported` means the harness',
    '> cannot do it — do not attempt it. `not-implemented` means it is buildable and unbuilt: that is',
    '> your work. `unverified` means find out first. `supported` without a passing fixture is a CI',
    '> failure, not a claim.',
    ''
  );

  lines.push('## Session binding', '');
  lines.push('| Field | Value |', '| --- | --- |');
  lines.push(`| Status | ${renderStatusCell(descriptor.binding)} |`);
  lines.push(`| Source | \`${descriptor.binding.source}\` |`);
  if (descriptor.binding.field) lines.push(`| Field | \`${descriptor.binding.field}\` |`);
  if (descriptor.binding.fallbackField) {
    lines.push(`| Fallback field | \`${descriptor.binding.fallbackField}\` |`);
  }
  lines.push(`| Evidence | ${renderEvidence(descriptor.binding)} |`);
  lines.push('');
  if (descriptor.binding.notes) lines.push(descriptor.binding.notes.trim(), '');
  lines.push(
    'The native session id is a **correlation alias only**. Authorization and mission scope come',
    'from the verified channel/session credential; neither the working directory nor an unverified',
    'native id is a binding authority.',
    ''
  );

  lines.push('## Decision hold', '');
  lines.push('| Field | Value |', '| --- | --- |');
  lines.push(`| Status | ${renderStatusCell(descriptor.decisionHold)} |`);
  if (descriptor.decisionHold.timeoutField) {
    lines.push(`| Timeout field | \`${descriptor.decisionHold.timeoutField}\` |`);
  }
  if (descriptor.decisionHold.defaultTimeoutSeconds !== undefined) {
    lines.push(`| Harness default | ${descriptor.decisionHold.defaultTimeoutSeconds}s |`);
  }
  lines.push(
    `| Harness ceiling | ${
      descriptor.decisionHold.maxTimeoutSeconds === null ||
      descriptor.decisionHold.maxTimeoutSeconds === undefined
        ? 'none documented'
        : `${descriptor.decisionHold.maxTimeoutSeconds}s`
    } |`
  );
  lines.push(`| Evidence | ${renderEvidence(descriptor.decisionHold)} |`, '');
  if (descriptor.decisionHold.notes) lines.push(descriptor.decisionHold.notes.trim(), '');

  lines.push('## Capabilities', '');
  lines.push('| Capability | Status | Native | Evidence |', '| --- | --- | --- | --- |');
  for (const id of CAPABILITY_IDS) {
    const node = descriptor.capabilities[id];
    lines.push(
      `| \`${id}\` | ${renderStatusCell(node)} | ${node?.native ? `\`${node.native}\`` : '—'} | ${
        renderEvidence(node) || '—'
      } |`
    );
  }
  lines.push('');

  const notes = CAPABILITY_IDS.filter(id => descriptor.capabilities[id]?.notes);
  if (notes.length > 0) {
    lines.push('### Capability notes', '');
    for (const id of notes)
      lines.push(`- **\`${id}\`** — ${descriptor.capabilities[id].notes.trim()}`);
    lines.push('');
  }

  if ((descriptor.hazards ?? []).length > 0) {
    lines.push('## Hazards', '');
    lines.push(
      '| Hazard | Severity | Verification | Mitigation | Tracked as |',
      '| --- | --- | --- | --- | --- |'
    );
    for (const hazard of descriptor.hazards) {
      lines.push(
        `| \`${hazard.id}\` | ${hazard.severity} | ${hazard.verification} | ${hazard.mitigation} | ${
          hazard.trackedAs
            ? `\`${hazard.trackedAs}\``
            : hazard.fixture
              ? `fixture \`${hazard.fixture}\``
              : '—'
        } |`
      );
    }
    lines.push('');
    for (const hazard of descriptor.hazards) {
      lines.push(`**\`${hazard.id}\`** — ${hazard.summary.trim()}`, '');
    }
  }

  lines.push('## Native decision shape', '');
  if (descriptor.decisionShape) {
    lines.push(`- **Codec** \`${descriptor.decisionShape.codec}\``);
    if (descriptor.decisionShape.neverSend?.length) {
      lines.push(
        `- **Never send** ${descriptor.decisionShape.neverSend.map(field => `\`${field}\``).join(', ')}`
      );
    }
    for (const [key, label] of [
      ['allowFixture', 'Allow'],
      ['denyFixture', 'Deny'],
      ['deferFixture', 'Defer']
    ]) {
      if (descriptor.decisionShape[key])
        lines.push(`- **${label} fixture** \`${descriptor.decisionShape[key]}\``);
    }
    lines.push('');
    if (descriptor.decisionShape.notes) lines.push(descriptor.decisionShape.notes.trim(), '');
  } else {
    lines.push('_No decision shape declared._', '');
  }

  lines.push('## Unbound-session negative test', '');
  lines.push(
    `Fixture: \`${descriptor.unboundSessionFixture}\` — proves what this adapter's registered`,
    'integrations do in a session with no Overlord binding, in an unrelated directory.',
    ''
  );

  return `${lines.join('\n')}\n`;
}

function renderMatrix({ adapters }) {
  const lines = [];
  lines.push(DO_NOT_EDIT, '');
  lines.push('# Harness capability matrix', '');
  lines.push(
    "Generated from each adapter's `harness-capabilities.yaml`. This file replaces the",
    'hand-written capability table that used to live in `connectors/README.md`: prose maintained',
    'by hand alongside code drifts, and a matrix that is 60% accurate is worse than none because',
    'it is trusted.',
    '',
    'Legend: ✅ supported (fixture-proven) · ⛔ unsupported (harness cannot) · 🚧 not-implemented',
    '(buildable, unbuilt) · ❓ unverified (find out first).',
    ''
  );

  lines.push('## Adapters', '');
  lines.push('| Adapter | Harness | Verified version | Shape | Tier | Binding | Decision hold |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const { adapter, descriptor, tier } of adapters) {
    lines.push(
      `| [\`${adapter}\`](adapters/${adapter}/CAPABILITIES.md) | ${descriptor.harness.name} | ${
        descriptor.harness.verifiedVersion ? `\`${descriptor.harness.verifiedVersion}\`` : '—'
      } | \`${descriptor.integrationShape}\` | ${tier} (${TIER_NAMES[tier]}) | ${renderStatusCell(
        descriptor.binding
      )} | ${renderStatusCell(descriptor.decisionHold)} |`
    );
  }
  lines.push('');

  lines.push('## Capabilities', '');
  lines.push(`| Capability | ${adapters.map(a => `\`${a.adapter}\``).join(' | ')} |`);
  lines.push(`| --- | ${adapters.map(() => '---').join(' | ')} |`);
  for (const id of CAPABILITY_IDS) {
    lines.push(
      `| \`${id}\` | ${adapters
        .map(a => renderStatusCell(a.descriptor.capabilities[id]))
        .join(' | ')} |`
    );
  }
  lines.push('');

  const hazardRows = adapters.flatMap(({ adapter, descriptor }) =>
    (descriptor.hazards ?? []).map(hazard => ({ adapter, hazard }))
  );
  if (hazardRows.length > 0) {
    lines.push('## Open hazards', '');
    lines.push('| Adapter | Hazard | Severity | Verification | Mitigation | Tracked as |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const { adapter, hazard } of hazardRows) {
      if (hazard.mitigation === 'implemented' && hazard.verification === 'verified') continue;
      lines.push(
        `| \`${adapter}\` | \`${hazard.id}\` | ${hazard.severity} | ${hazard.verification} | ${
          hazard.mitigation
        } | ${hazard.trackedAs ? `\`${hazard.trackedAs}\`` : '—'} |`
      );
    }
    lines.push('');
  }

  lines.push('## Reading this table', '');
  lines.push(
    'Before writing any code for a harness, read its descriptor or run',
    '`ovld agent-session capabilities <agent>`. Do not attempt an `unsupported` capability. If you',
    'believe the cited evidence is now wrong, replace `evidenceRef` and add the executable fixture',
    'in the same change that flips the status.',
    ''
  );
  return `${lines.join('\n')}\n`;
}

// ── Codec compilation ─────────────────────────────────────────────────────────
//
// Connector-owned event codecs are declarations of *where native values live*, compiled here
// into a bundle the CLI executes. The CLI owns transport and execution; it is deliberately not
// the source of truth for any harness dialect, because a dialect belongs to the connector that
// speaks it and will change on that harness's release schedule, not ours.

const NORMALIZED_EVENT_KINDS = [
  'session.started',
  'session.ended',
  'prompt.submitted',
  'tool.called',
  'tool.completed',
  'file.edited',
  'notice'
];

const CODEC_RULE_KEYS = new Set([
  'native',
  'kind',
  'origin',
  'severity',
  'toolPath',
  'inputPath',
  'callIdPath',
  'turnIdPath',
  'subagentIdPath',
  'promptPath',
  'detailPath',
  'outcomePath',
  'fileEditKind'
]);

/**
 * Validate a codec declaration.
 *
 * The strict unknown-key rejection is the load-bearing check. A typo'd `inputpath` would
 * silently produce cards with no detail — a degradation nobody notices for months — and an
 * *invented* key is how a codec author would try to route a native field somewhere the
 * interpreter does not sanction.
 */
function validateCodec({ adapter, codec, errors }) {
  const at = field => `${adapter} codec ${field}`;
  if (codec?.codecVersion !== 1) errors.push(`${at('codecVersion')}: must be 1`);
  if (codec?.adapter !== adapter) {
    errors.push(`${at('adapter')}: must equal the adapter directory name (${adapter})`);
  }
  if (!Array.isArray(codec?.events) || codec.events.length === 0) {
    errors.push(`${at('events')}: at least one event rule is required`);
    return;
  }
  const seen = new Set();
  for (const rule of codec.events) {
    for (const key of Object.keys(rule)) {
      if (!CODEC_RULE_KEYS.has(key))
        errors.push(`${at(`events.${rule.native}`)}: unknown key "${key}"`);
    }
    if (typeof rule.native !== 'string' || rule.native === '') {
      errors.push(`${at('events')}: every rule needs a native event name`);
      continue;
    }
    if (seen.has(rule.native)) errors.push(`${at('events')}: duplicate rule for "${rule.native}"`);
    seen.add(rule.native);
    if (!NORMALIZED_EVENT_KINDS.includes(rule.kind)) {
      errors.push(
        `${at(`events.${rule.native}`)}: kind "${rule.kind}" is outside the normalized vocabulary`
      );
    }
    if (rule.fileEditKind && !NORMALIZED_EVENT_KINDS.includes(rule.fileEditKind)) {
      errors.push(
        `${at(`events.${rule.native}`)}: fileEditKind "${rule.fileEditKind}" is outside the normalized vocabulary`
      );
    }
    if (!['agent', 'user', 'system'].includes(rule.origin)) {
      errors.push(`${at(`events.${rule.native}`)}: origin must be agent, user, or system`);
    }
  }
}

const DECISION_RULE_KEYS = new Set([
  'native',
  'tool',
  'toolPath',
  'inputPath',
  'inputWrapKey',
  'requestIdPaths',
  'callIdPaths',
  'timeoutPaths'
]);

function validateDecisionCodec({ adapter, codec, errors }) {
  const at = field => `${adapter} decision codec ${field}`;
  if (codec?.codecVersion !== 1) errors.push(`${at('codecVersion')}: must be 1`);
  if (codec?.adapter !== adapter) errors.push(`${at('adapter')}: must equal ${adapter}`);
  if (!Array.isArray(codec?.eventNamePaths) || codec.eventNamePaths.length === 0) {
    errors.push(`${at('eventNamePaths')}: at least one path is required`);
  }
  if (!Array.isArray(codec?.requests) || codec.requests.length === 0) {
    errors.push(`${at('requests')}: at least one request rule is required`);
  } else {
    const seen = new Set();
    for (const rule of codec.requests) {
      for (const key of Object.keys(rule)) {
        if (!DECISION_RULE_KEYS.has(key))
          errors.push(`${at(`requests.${rule.native}`)}: unknown key "${key}"`);
      }
      if (typeof rule.native !== 'string' || rule.native === '')
        errors.push(`${at('requests')}: native is required`);
      if (seen.has(rule.native))
        errors.push(`${at('requests')}: duplicate rule for ${rule.native}`);
      seen.add(rule.native);
      if (
        rule.tool &&
        !['shell', 'read', 'write', 'edit', 'fetch', 'search', 'mcp', 'task', 'generic'].includes(
          rule.tool
        )
      ) {
        errors.push(`${at(`requests.${rule.native}.tool`)}: outside normalized tool vocabulary`);
      }
    }
  }
  for (const decision of ['allow', 'deny', 'ask']) {
    const response = codec?.responses?.[decision];
    const valid =
      response &&
      typeof response === 'object' &&
      Object.hasOwn(response, 'body') !== Object.hasOwn(response, 'defer');
    if (!valid) errors.push(`${at(`responses.${decision}`)}: require exactly one of body or defer`);
  }
}

function renderCodecRegistry({ codecs }) {
  const body = Object.fromEntries(codecs.map(entry => [entry.adapter, entry.codec]));
  return `/* GENERATED FILE — DO NOT EDIT.
 * Source: connectors/adapters/<agent>/codec/<agent>.codec.yaml
 * Regenerate with \`yarn connectors:capabilities\`.
 *
 * Connector-owned event dialects, compiled for the CLI to execute. The runtime reads THIS
 * bundle rather than the YAML: parsing YAML from disk on a hook path would violate the latency
 * invariant, and the installed adapter may be older than the CLI.
 *
 * A codec declares only WHERE native values live. It cannot name a destination the core
 * interpreter (\`packages/core/service/agent-session/pure/codec.ts\`) does not implement, which
 * is what makes "no raw payload leaves the machine" a structural property rather than a rule
 * each codec author has to remember.
 */

import type { CodecSpec } from '@overlord/core/service/agent-session/pure/codec';

export const AGENT_SESSION_CODECS: Record<string, CodecSpec> = ${JSON.stringify(body, null, 2)} as const;

/** Look up a compiled codec by adapter key. \`null\` for an adapter with no push path yet. */
export function findAgentSessionCodec(adapter: string): CodecSpec | null {
  return AGENT_SESSION_CODECS[adapter] ?? null;
}
`;
}

function renderDecisionCodecRegistry({ codecs }) {
  const body = Object.fromEntries(codecs.map(entry => [entry.adapter, entry.codec]));
  return `/* GENERATED FILE — DO NOT EDIT.\n * Source: connectors/adapters/<agent>/codec/<agent>.decision-codec.yaml\n * Regenerate with \`yarn connectors:capabilities\`.\n */\n\nimport type { DecisionCodecSpec } from '@overlord/core/service/agent-session/pure/decision';\n\nexport const AGENT_SESSION_DECISION_CODECS: Record<string, DecisionCodecSpec> = ${JSON.stringify(body, null, 2)} as const;\n\nexport function findAgentSessionDecisionCodec(adapter: string): DecisionCodecSpec | null {\n  return AGENT_SESSION_DECISION_CODECS[adapter] ?? null;\n}\n`;
}

function renderCatalog({ adapters }) {
  const catalog = adapters.map(({ adapter, descriptor, tier, digest }) => ({
    adapter,
    codec: descriptor.codec,
    integrationShape: descriptor.integrationShape,
    capabilityTier: tier,
    descriptorDigest: digest,
    descriptorSchemaVersion: descriptor.schemaVersion,
    harness: descriptor.harness,
    binding: {
      source: descriptor.binding.source,
      field: descriptor.binding.field ?? null,
      fallbackField: descriptor.binding.fallbackField ?? null,
      status: descriptor.binding.status
    },
    decisionHold: {
      status: descriptor.decisionHold.status,
      timeoutField: descriptor.decisionHold.timeoutField ?? null,
      timeoutUnit: descriptor.decisionHold.timeoutUnit ?? null,
      defaultTimeoutSeconds: descriptor.decisionHold.defaultTimeoutSeconds ?? null,
      maxTimeoutSeconds: descriptor.decisionHold.maxTimeoutSeconds ?? null
    },
    capabilities: Object.fromEntries(
      CAPABILITY_IDS.map(id => {
        const node = descriptor.capabilities[id];
        return [
          id,
          {
            status: node.status,
            native: node.native ?? null,
            reason: node.reason?.trim() ?? null,
            evidenceRef: node.evidenceRef ?? null,
            trackedAs: node.trackedAs ?? null
          }
        ];
      })
    ),
    hazards: (descriptor.hazards ?? []).map(hazard => ({
      id: hazard.id,
      severity: hazard.severity,
      summary: hazard.summary.trim(),
      verification: hazard.verification,
      mitigation: hazard.mitigation,
      trackedAs: hazard.trackedAs ?? null
    })),
    decisionShape: descriptor.decisionShape
      ? {
          codec: descriptor.decisionShape.codec,
          neverSend: descriptor.decisionShape.neverSend ?? []
        }
      : null
  }));

  return `/* GENERATED FILE — DO NOT EDIT.
 * Source: connectors/adapters/<agent>/harness-capabilities.yaml
 * Regenerate with \`yarn connectors:capabilities\`.
 *
 * The runtime reads THIS compiled bundle, never the YAML: parsing YAML from disk on a hook
 * path would violate the latency invariant, and the installed adapter may be older than the
 * CLI. \`ovld doctor\` compares the installed descriptor digest with the digests below.
 *
 * This is the STATIC catalog maximum. Web and mobile must gate controls on the effective
 * capability snapshot stored on the live session channel, which installed harness version,
 * hook trust, connector drift, project policy, and runtime probes may all downgrade.
 */

export const AGENT_SESSION_CAPABILITY_IDS = ${JSON.stringify(CAPABILITY_IDS, null, 2)} as const;

export type AgentSessionCapabilityId = (typeof AGENT_SESSION_CAPABILITY_IDS)[number];

export type AgentSessionCapabilityStatus =
  | 'supported'
  | 'unsupported'
  | 'not-implemented'
  | 'unverified';

export type HarnessIntegrationShape = 'callback' | 'extension' | 'controlPlane';

export type HarnessCapabilityEntry = {
  status: AgentSessionCapabilityStatus;
  native: string | null;
  reason: string | null;
  evidenceRef: string | null;
  trackedAs: string | null;
};

export type HarnessDescriptor = {
  adapter: string;
  codec: string;
  integrationShape: HarnessIntegrationShape;
  capabilityTier: 0 | 1 | 2 | 3;
  descriptorDigest: string;
  descriptorSchemaVersion: number;
  harness: {
    name: string;
    verifiedVersion?: string;
    versionRange?: string;
    versionScheme: 'semver' | 'calendar' | 'opaque';
  };
  binding: {
    source: 'env' | 'payload' | 'api' | 'none';
    field: string | null;
    fallbackField: string | null;
    status: AgentSessionCapabilityStatus;
  };
  decisionHold: {
    status: AgentSessionCapabilityStatus;
    timeoutField: string | null;
    timeoutUnit: 'seconds' | 'milliseconds' | null;
    defaultTimeoutSeconds: number | null;
    maxTimeoutSeconds: number | null;
  };
  capabilities: Record<AgentSessionCapabilityId, HarnessCapabilityEntry>;
  hazards: Array<{
    id: string;
    severity: 'low' | 'medium' | 'high';
    summary: string;
    verification: 'verified' | 'unverified';
    mitigation: 'required' | 'implemented' | 'accepted';
    trackedAs: string | null;
  }>;
  decisionShape: { codec: string; neverSend: string[] } | null;
};

export const HARNESS_CAPABILITY_TIER_NAMES = ${JSON.stringify(TIER_NAMES, null, 2)} as const;

export const HARNESS_DESCRIPTORS: HarnessDescriptor[] = ${JSON.stringify(catalog, null, 2)};

export const HARNESS_CATALOG_DIGEST = '${sha256(JSON.stringify(catalog))}';

export function findHarnessDescriptor(adapter: string): HarnessDescriptor | undefined {
  return HARNESS_DESCRIPTORS.find(entry => entry.adapter === adapter);
}
`;
}

/**
 * Rewrite the generated block of a conformance manifest in place.
 *
 * The manifest keeps its hand-authored identity fields; only the connector capability
 * projection is regenerated, so there are never two hand-authored capability sources that
 * can disagree.
 */
function projectConformanceManifest({ manifestText, descriptor, tier, digest, descriptorPath }) {
  const legacyCapabilities = [...(descriptor.legacy?.capabilities ?? [])];
  const legacyHookTypes = [...(descriptor.legacy?.hookTypes ?? [])];

  const block = [
    '  # ── GENERATED: do not edit by hand ───────────────────────────────────────────',
    `  # Projected from ${descriptorPath} by \`yarn connectors:capabilities\`.`,
    '  # `capabilities` and `hookTypes` are the DEPRECATED hook-named projection, retained for',
    '  # one release. `harnessCapabilities` is the authoritative source.',
    `  integrationShape: ${descriptor.integrationShape}`,
    `  capabilityTier: ${tier}`,
    '  harnessCapabilities:',
    `    path: ${descriptorPath}`,
    `    schemaVersion: ${descriptor.schemaVersion}`,
    `    digest: "${digest}"`,
    '  capabilities:',
    ...legacyCapabilities.map(flag => `    - ${flag}`),
    ...(legacyHookTypes.length > 0
      ? ['  hookTypes:', ...legacyHookTypes.map(hookType => `    - ${hookType}`)]
      : []),
    '  # ── END GENERATED ────────────────────────────────────────────────────────────'
  ].join('\n');

  const lines = manifestText.split('\n');
  const output = [];
  let index = 0;
  let injected = false;
  let insideConnector = false;

  while (index < lines.length) {
    const line = lines[index];
    if (/^connector:\s*$/.test(line)) {
      insideConnector = true;
      output.push(line);
      index += 1;
      continue;
    }
    if (insideConnector && /^\S/.test(line) && line.trim() !== '') {
      // Leaving the connector block — append the generated projection if it has not landed yet.
      if (!injected) {
        output.push(block);
        injected = true;
      }
      insideConnector = false;
      output.push(line);
      index += 1;
      continue;
    }
    if (insideConnector) {
      // Drop every previously generated or hand-authored projection field.
      if (/^\s*#\s*──\s*GENERATED/.test(line)) {
        while (index < lines.length && !/^\s*#\s*──\s*END GENERATED/.test(lines[index])) index += 1;
        index += 1;
        if (!injected) {
          output.push(block);
          injected = true;
        }
        continue;
      }
      if (
        /^\s{2}(capabilities|hookTypes|integrationShape|capabilityTier|harnessCapabilities):/.test(
          line
        )
      ) {
        index += 1;
        while (index < lines.length && /^\s{4,}\S/.test(lines[index])) index += 1;
        if (!injected) {
          output.push(block);
          injected = true;
        }
        continue;
      }
    }
    output.push(line);
    index += 1;
  }
  if (!injected) output.push(block);

  return output.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const check = process.argv.includes('--check');
  const errors = [];
  const extensionPoints = readYaml(extensionPointsPath);
  const approved = {
    capabilities: extensionPoints.approvedConnectorCapabilities ?? [],
    hookTypes: extensionPoints.approvedHookTypes ?? []
  };

  const adapters = [];
  const codecs = [];
  const decisionCodecs = [];
  for (const adapter of listAdapters()) {
    const descriptorPath = path.join(adaptersDir, adapter, 'harness-capabilities.yaml');
    if (!existsSync(descriptorPath)) {
      errors.push(
        `${adapter}: missing harness-capabilities.yaml. Every shipped connector must have a` +
          ' descriptor — omitting one makes the generated matrix less truthful than no matrix.'
      );
      continue;
    }
    const raw = readFileSync(descriptorPath, 'utf8');
    const descriptor = parseYaml(raw);
    validateDescriptor({ adapter, descriptor, approved, errors });
    if (errors.length > 0 && !descriptor?.capabilities) continue;
    runAdapterFixtures({ adapter, descriptor, errors });
    if (descriptor?.codecSpec) {
      const codecPath = path.join(adaptersDir, adapter, descriptor.codecSpec);
      if (!existsSync(codecPath)) {
        errors.push(`${adapter}: codecSpec not found: ${descriptor.codecSpec}`);
      } else {
        const codec = parseYaml(readFileSync(codecPath, 'utf8'));
        validateCodec({ adapter, codec, errors });
        codecs.push({ adapter, codec });
      }
    }
    if (descriptor?.decisionCodecSpec) {
      const codecPath = path.join(adaptersDir, adapter, descriptor.decisionCodecSpec);
      if (!existsSync(codecPath)) {
        errors.push(`${adapter}: decisionCodecSpec not found: ${descriptor.decisionCodecSpec}`);
      } else {
        const codec = parseYaml(readFileSync(codecPath, 'utf8'));
        validateDecisionCodec({ adapter, codec, errors });
        decisionCodecs.push({ adapter, codec });
      }
    }
    adapters.push({
      adapter,
      descriptor,
      digest: sha256(raw),
      tier: deriveTier({ descriptor }),
      descriptorPath: `connectors/adapters/${adapter}/harness-capabilities.yaml`
    });
  }

  if (errors.length > 0) {
    console.error('Harness capability descriptors are invalid:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  const outputs = [];
  for (const entry of adapters) {
    outputs.push({
      filePath: path.join(adaptersDir, entry.adapter, 'CAPABILITIES.md'),
      contents: renderAdapterPage(entry)
    });
    const manifestPath = path.join(adaptersDir, entry.adapter, 'conformance-manifest.yaml');
    if (existsSync(manifestPath)) {
      outputs.push({
        filePath: manifestPath,
        contents: projectConformanceManifest({
          manifestText: readFileSync(manifestPath, 'utf8'),
          ...entry
        })
      });
    } else {
      errors.push(`${entry.adapter}: missing conformance-manifest.yaml`);
    }
  }
  outputs.push({
    filePath: path.join(repoRoot, 'connectors', 'HARNESS-MATRIX.md'),
    contents: renderMatrix({ adapters })
  });
  outputs.push({
    filePath: path.join(
      repoRoot,
      'cli',
      'src',
      'agent-session',
      'decision-codec-registry.generated.ts'
    ),
    contents: renderDecisionCodecRegistry({ codecs: decisionCodecs })
  });
  outputs.push({
    filePath: path.join(repoRoot, 'cli', 'src', 'agent-session', 'catalog.generated.ts'),
    contents: renderCatalog({ adapters })
  });
  outputs.push({
    filePath: path.join(repoRoot, 'cli', 'src', 'agent-session', 'codec-registry.generated.ts'),
    contents: renderCodecRegistry({ codecs })
  });

  if (errors.length > 0) {
    console.error('Harness capability generation failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  const drift = [];
  for (const { filePath, contents } of outputs) {
    const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
    if (existing === contents) continue;
    drift.push(path.relative(repoRoot, filePath));
    if (!check) writeFileSync(filePath, contents);
  }

  if (check) {
    if (drift.length > 0) {
      console.error('Generated harness capability artifacts are out of date:');
      for (const file of drift) console.error(`- ${file}`);
      console.error('Run `yarn connectors:capabilities` and commit the result.');
      process.exit(1);
    }
    console.log(
      `Harness capability check passed: ${adapters.length} descriptor(s) validated, fixtures executed, artifacts current.`
    );
    return;
  }

  console.log(
    `Harness capabilities generated: ${adapters.length} descriptor(s), ${drift.length} file(s) updated.`
  );
  for (const file of drift) console.log(`- ${file}`);
}

main();
