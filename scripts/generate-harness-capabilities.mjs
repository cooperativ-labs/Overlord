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
 *                                                 integrationShape, capabilityTier, and the
 *                                                 descriptor pointer/digest
 *   contract/examples/connector-claude-conformance-manifest.yaml
 *                                                 reference connector projection
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

import { FIXTURE_KINDS, runFixture } from './harness-capability-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adaptersDir = path.join(repoRoot, 'connectors', 'adapters');
const extensionPointsPath = path.join(repoRoot, 'contract', 'extension-points.yaml');
const descriptorSchemaPath = path.join(repoRoot, 'contract', 'harness-capabilities.schema.yaml');
const componentsPath = path.join(repoRoot, 'contract', 'components.yaml');
const TIER_NAMES = ['Unsupported', 'Observational', 'Answerable', 'Conversational'];
const DO_NOT_EDIT =
  '<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->';

function readYaml(filePath) {
  return parseYaml(readFileSync(filePath, 'utf8'));
}

const descriptorSchema = readYaml(descriptorSchemaPath);
const CAPABILITY_IDS = descriptorSchema.properties.capabilities.propertyNames.enum;
const STATUSES = descriptorSchema.$defs.capabilityStatus.enum;
const INTEGRATION_SHAPES = descriptorSchema.properties.integrationShape.enum;

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
// The checked-in JSON Schema is normative. This small Draft 2020-12 subset interpreter covers
// every keyword that schema uses, so adding a required field, enum member, pattern, conditional,
// or unknown-property rule changes validation without duplicating it below. Cross-file and
// executable-evidence invariants remain explicit after schema validation.

function resolveSchemaRef(rootSchema, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  return ref
    .slice(2)
    .split('/')
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((node, segment) => node?.[segment], rootSchema);
}

function valueMatchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

export function validateAgainstSchema(value, schema, rootSchema = schema, location = '$') {
  if (!schema || typeof schema !== 'object') return [];
  const errors = [];

  if (schema.$ref) {
    const target = resolveSchemaRef(rootSchema, schema.$ref);
    if (!target) return [`${location}: unresolved schema reference ${schema.$ref}`];
    errors.push(...validateAgainstSchema(value, target, rootSchema, location));
  }

  for (const branch of schema.allOf ?? []) {
    errors.push(...validateAgainstSchema(value, branch, rootSchema, location));
  }
  if (schema.anyOf) {
    const matches = schema.anyOf.some(
      branch => validateAgainstSchema(value, branch, rootSchema, location).length === 0
    );
    if (!matches) errors.push(`${location}: must match at least one allowed schema`);
  }
  if (
    schema.if &&
    validateAgainstSchema(value, schema.if, rootSchema, location).length === 0 &&
    schema.then
  ) {
    errors.push(...validateAgainstSchema(value, schema.then, rootSchema, location));
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${location}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some(entry => JSON.stringify(entry) === JSON.stringify(value))) {
    errors.push(`${location}: must be one of ${schema.enum.map(JSON.stringify).join(', ')}`);
  }

  if (schema.type) {
    const accepted = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!accepted.some(type => valueMatchesType(value, type))) {
      errors.push(`${location}: must be ${accepted.join(' or ')}`);
      return errors;
    }
  }

  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  if (isObject) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${location}: missing required field ${key}`);
    }
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      errors.push(`${location}: must contain at least ${schema.minProperties} properties`);
    }
    for (const key of Object.keys(value)) {
      if (schema.propertyNames) {
        errors.push(
          ...validateAgainstSchema(key, schema.propertyNames, rootSchema, `${location}.${key}`)
        );
      }
      if (Object.hasOwn(properties, key)) {
        errors.push(
          ...validateAgainstSchema(value[key], properties[key], rootSchema, `${location}.${key}`)
        );
      } else if (schema.additionalProperties === false) {
        errors.push(`${location}: unexpected field ${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(
          ...validateAgainstSchema(
            value[key],
            schema.additionalProperties,
            rootSchema,
            `${location}.${key}`
          )
        );
      }
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${location}: must contain at least ${schema.minItems} items`);
    }
    if (schema.uniqueItems) {
      const keys = value.map(entry => JSON.stringify(entry));
      if (new Set(keys).size !== keys.length) errors.push(`${location}: items must be unique`);
    }
    if (schema.items) {
      value.forEach((entry, index) => {
        errors.push(
          ...validateAgainstSchema(entry, schema.items, rootSchema, `${location}[${index}]`)
        );
      });
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${location}: must contain at least ${schema.minLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${location}: must match ${schema.pattern}`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${location}: must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${location}: must be at most ${schema.maximum}`);
    }
  }
  return errors;
}

function validateDescriptor({ adapter, descriptor, errors }) {
  const at = field => `${adapter}/harness-capabilities.yaml ${field}`;

  for (const error of validateAgainstSchema(descriptor, descriptorSchema)) {
    errors.push(`${adapter}/harness-capabilities.yaml ${error}`);
  }

  if (descriptor.adapter !== adapter) {
    errors.push(at('adapter') + `: must equal the directory name (${adapter})`);
  }

  const capabilities = descriptor.capabilities ?? {};
  for (const id of CAPABILITY_IDS) {
    const node = capabilities[id];
    if (!node) {
      errors.push(
        at(`capabilities.${id}`) +
          ': missing. Every capability id must be declared — an omission reads as a claim.'
      );
      continue;
    }
    if (node.status === 'supported' && node.evidenceRef) {
      errors.push(
        at(`capabilities.${id}`) +
          ': promoting a status out of unsupported must replace evidenceRef with fixtures'
      );
    }
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function collectFixtureRefs(descriptor) {
  const refs = new Set();
  if (descriptor.binding?.fixture) refs.add(descriptor.binding.fixture);
  if (descriptor.decisionHold?.fixture) refs.add(descriptor.decisionHold.fixture);
  if (descriptor.mutationHooks?.fixture) refs.add(descriptor.mutationHooks.fixture);
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

  const mutationFixture = descriptor.mutationHooks?.fixture;
  if (mutationFixture) {
    const result = results[mutationFixture];
    if (result?.kind !== 'mutation-window') {
      errors.push(`${adapter}: mutationHooks.fixture must be a mutation-window fixture`);
    } else if (result.observed?.classification !== descriptor.mutationHooks.classification) {
      errors.push(
        `${adapter}: mutationHooks classification ${descriptor.mutationHooks.classification} does not match ` +
          `fixture classification ${result.observed?.classification ?? 'missing'}`
      );
    }
  }

  // An executable unbound-session fixture is a hard negative boundary. A fixture cannot make a
  // side effect acceptable by declaring it as the expected result.
  const unbound = descriptor.unboundSessionFixture;
  const unboundResult = unbound ? results[unbound] : null;
  if (unboundResult?.kind === 'script-io') {
    if ((unboundResult.observed?.cliInvocations?.length ?? 0) > 0) {
      errors.push(`${adapter}: unbound-session fixture attempted a CLI invocation`);
    }
    if ((unboundResult.observed?.sandboxWrites?.length ?? 0) > 0) {
      errors.push(`${adapter}: unbound-session fixture wrote inside its sandbox`);
    }
    if (unboundResult.observed?.stdout !== '' || unboundResult.observed?.stderr !== '') {
      errors.push(`${adapter}: unbound-session fixture must be silent`);
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
// demonstrates with a passing fixture; asserted-but-unproven is worse than absent, because the
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

function renderAdapterPage({ adapter, descriptor, tier, digest, fixtureResults }) {
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

  lines.push('## Mutation-window evidence', '');
  lines.push('| Field | Value |', '| --- | --- |');
  lines.push(`| Classification | \`${descriptor.mutationHooks.classification}\` |`);
  lines.push(`| Executable fixture | \`${descriptor.mutationHooks.fixture}\` |`, '');
  if (descriptor.mutationHooks.notes) lines.push(descriptor.mutationHooks.notes.trim(), '');
  if (descriptor.mutationHooks.reason) lines.push(descriptor.mutationHooks.reason.trim(), '');
  if (descriptor.mutationHooks.classification === 'post-only') {
    const directPathEvidence =
      fixtureResults?.[descriptor.mutationHooks.fixture]?.observed?.directPathEvidence === 'direct';
    if (directPathEvidence) {
      lines.push(
        'A completion callback path normalized by the connector-owned codec as `file.edited`',
        'records objective-bound, non-exclusive `declared_edit`/`direct` evidence.',
        'Codec-normalized read, search, and fetch callbacks are silent no-ops. Mutation-capable',
        'callbacks without a normalized edit path, plus shell, generic, unknown, and unmapped',
        'callbacks, record unavailable evidence health.',
        ''
      );
    } else {
      lines.push(
        'The completion fixture proves post-only timing but exposes no normalized `file.edited`',
        'path. Runtime file evidence is unavailable for this adapter.',
        ''
      );
    }
  } else if (descriptor.mutationHooks.classification === 'paired') {
    lines.push(
      'The fixture proves a matching native pre/post window. Runtime window evidence must retain',
      'the same session, call, workspace, tool, outcome, and direct-path semantics.',
      ''
    );
  } else {
    lines.push(
      'File attribution may not be synthesized for this adapter. Missing mutation evidence is',
      'reported as unavailable health, never recovered from a worktree-wide delta.',
      ''
    );
  }

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
    "Generated from each adapter's fixture-backed `harness-capabilities.yaml` descriptor.",
    'The descriptor is the single authored capability source; the tier and every table cell are',
    'derived.',
    '',
    'Legend: ✅ supported (fixture-proven) · ⛔ unsupported (harness cannot) · 🚧 not-implemented',
    '(buildable, unbuilt) · ❓ unverified (find out first).',
    ''
  );

  lines.push('## Adapters', '');
  lines.push('| Adapter | Harness | Verified version | Shape | Tier | Mutation evidence | Binding | Decision hold |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const { adapter, descriptor, tier } of adapters) {
    lines.push(
      `| [\`${adapter}\`](adapters/${adapter}/CAPABILITIES.md) | ${descriptor.harness.name} | ${
        descriptor.harness.verifiedVersion ? `\`${descriptor.harness.verifiedVersion}\`` : '—'
      } | \`${descriptor.integrationShape}\` | ${tier} (${TIER_NAMES[tier]}) | \`${descriptor.mutationHooks.classification}\` | ${renderStatusCell(
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
  'fileEditKind',
  'filePathPaths'
]);

function isBoundedDottedPath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    /^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/.test(value)
  );
}

/**
 * Validate a codec declaration.
 *
 * The strict unknown-key rejection is the load-bearing check. A typo'd `inputpath` would
 * silently produce cards with no detail — a degradation nobody notices for months — and an
 * *invented* key is how a codec author would try to route a native field somewhere the
 * interpreter does not sanction.
 */
export function validateCodec({ adapter, codec, errors, integrationShape }) {
  const at = field => `${adapter} codec ${field}`;
  if (codec?.codecVersion !== 1) errors.push(`${at('codecVersion')}: must be 1`);
  if (codec?.adapter !== adapter) {
    errors.push(`${at('adapter')}: must equal the adapter directory name (${adapter})`);
  }
  if (codec?.eventNamePaths !== undefined) {
    // A misdeclared plural is silent at runtime: the name never resolves, no rule matches, and
    // the interpreter's normal "nothing to say" outcome hides it. Reject it here instead.
    if (
      !Array.isArray(codec.eventNamePaths) ||
      codec.eventNamePaths.length === 0 ||
      codec.eventNamePaths.some(entry => typeof entry !== 'string' || entry === '')
    ) {
      errors.push(`${at('eventNamePaths')}: must be a non-empty array of dotted paths`);
    }
  }
  if (
    integrationShape !== 'controlPlane' &&
    codec?.eventNamePath === undefined &&
    codec?.eventNamePaths === undefined
  ) {
    // Only a control-plane adapter may omit both, because there the transport names the event.
    // A callback adapter that omits them normalizes nothing at all.
    errors.push(
      `${at('eventNamePath')}: a payload-named codec needs eventNamePath or eventNamePaths`
    );
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
    if (rule.fileEditKind !== undefined && rule.fileEditKind !== 'file.edited') {
      errors.push(
        `${at(`events.${rule.native}`)}: fileEditKind must be the literal "file.edited"`
      );
    }
    if (rule.fileEditKind === 'file.edited') {
      if (!isBoundedDottedPath(rule.toolPath) || !isBoundedDottedPath(rule.inputPath)) {
        errors.push(
          `${at(`events.${rule.native}`)}: fileEditKind requires toolPath and inputPath`
        );
      }
      if (
        !Array.isArray(rule.filePathPaths) ||
        rule.filePathPaths.length === 0 ||
        rule.filePathPaths.length > 8 ||
        rule.filePathPaths.some(path => !isBoundedDottedPath(path)) ||
        new Set(rule.filePathPaths).size !== rule.filePathPaths.length
      ) {
        errors.push(
          `${at(`events.${rule.native}`)}: filePathPaths must contain 1-8 unique bounded dotted paths relative to inputPath`
        );
      }
    } else if (rule.filePathPaths !== undefined) {
      errors.push(
        `${at(`events.${rule.native}`)}: filePathPaths is only valid with fileEditKind "file.edited"`
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
  const catalog = adapters.map(({ adapter, descriptor, tier, digest, fixtureResults }) => ({
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
    mutationHooks: (() => {
      const hasDirectPath =
        fixtureResults?.[descriptor.mutationHooks.fixture]?.observed?.directPathEvidence ===
        'direct';
      return {
        classification: descriptor.mutationHooks.classification,
        pathEvidenceSource:
          !hasDirectPath
            ? 'unavailable'
            : descriptor.mutationHooks.classification === 'paired'
              ? 'window_observed'
              : 'declared_edit',
        pathEvidenceQuality:
          !hasDirectPath
            ? 'unavailable'
            : descriptor.mutationHooks.classification === 'paired'
              ? 'window'
              : 'direct',
        shellEvidence: 'unavailable',
        pathlessEvidence: 'unavailable',
        fixture: descriptor.mutationHooks.fixture,
        reason: descriptor.mutationHooks.reason?.trim() ?? null,
        evidenceRef: descriptor.mutationHooks.evidenceRef ?? null,
        notes: descriptor.mutationHooks.notes?.trim() ?? null
      };
    })(),
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

export type MutationHookClassification = 'paired' | 'post-only' | 'unsupported';

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
  mutationHooks: {
    classification: MutationHookClassification;
    pathEvidenceSource: 'declared_edit' | 'window_observed' | 'unavailable';
    pathEvidenceQuality: 'direct' | 'window' | 'unavailable';
    shellEvidence: 'unavailable';
    pathlessEvidence: 'unavailable';
    fixture: string;
    reason: string | null;
    evidenceRef: string | null;
    notes: string | null;
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
 * The manifest keeps its hand-authored identity and install fields. Contract version and the
 * connector descriptor projection are regenerated, so stale manifests cannot validate against
 * an older contract and there is no second capability source to drift.
 */
function projectConformanceManifest({
  manifestText,
  descriptor,
  tier,
  digest,
  descriptorPath,
  contractVersion
}) {
  const block = [
    '  # ── GENERATED: do not edit by hand ───────────────────────────────────────────',
    `  # Projected from ${descriptorPath} by \`yarn connectors:capabilities\`.`,
    '  # The harness descriptor and its executable fixtures are the only capability source.',
    `  integrationShape: ${descriptor.integrationShape}`,
    `  capabilityTier: ${tier}`,
    '  harnessCapabilities:',
    `    path: ${descriptorPath}`,
    `    schemaVersion: ${descriptor.schemaVersion}`,
    `    digest: "${digest}"`,
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
      // Replace the current generated projection as one atomic block.
      if (/^\s*#\s*──\s*GENERATED/.test(line)) {
        while (index < lines.length && !/^\s*#\s*──\s*END GENERATED/.test(lines[index])) index += 1;
        index += 1;
        if (!injected) {
          output.push(block);
          injected = true;
        }
        continue;
      }
      if (/^\s{2}(integrationShape|capabilityTier|harnessCapabilities):/.test(line)) {
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

  return output
    .join('\n')
    .replace(/^contractVersion:\s*.*$/m, `contractVersion: "${contractVersion}"`)
    .replace(/\n{3,}/g, '\n\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const check = process.argv.includes('--check');
  const errors = [];
  const extensionPoints = readYaml(extensionPointsPath);
  const components = readYaml(componentsPath);
  const contractVersion = String(components.contractVersion);
  const vocabularyChecks = [
    ['capability ids', CAPABILITY_IDS, extensionPoints.agentSession?.capabilityIds ?? []],
    ['capability statuses', STATUSES, extensionPoints.agentSession?.capabilityStatuses ?? []],
    ['integration shapes', INTEGRATION_SHAPES, extensionPoints.agentSession?.integrationShapes ?? []],
    ['fixture kinds', FIXTURE_KINDS, extensionPoints.agentSession?.fixtureKinds ?? []]
  ];
  for (const [label, schemaValues, registryValues] of vocabularyChecks) {
    if (JSON.stringify(schemaValues) !== JSON.stringify(registryValues)) {
      errors.push(
        `harness descriptor ${label} drift between contract/harness-capabilities.schema.yaml ` +
          'and contract/extension-points.yaml'
      );
    }
  }

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
    validateDescriptor({ adapter, descriptor, errors });
    if (errors.length > 0 && !descriptor?.capabilities) continue;
    const fixtureResults = runAdapterFixtures({ adapter, descriptor, errors });
    if (descriptor?.codecSpec) {
      const codecPath = path.join(adaptersDir, adapter, descriptor.codecSpec);
      if (!existsSync(codecPath)) {
        errors.push(`${adapter}: codecSpec not found: ${descriptor.codecSpec}`);
      } else {
        const codec = parseYaml(readFileSync(codecPath, 'utf8'));
        validateCodec({ adapter, codec, errors, integrationShape: descriptor?.integrationShape });
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
      fixtureResults,
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
          contractVersion,
          ...entry
        })
      });
    } else {
      errors.push(`${entry.adapter}: missing conformance-manifest.yaml`);
    }
  }
  const connectorExamplePath = path.join(
    repoRoot,
    'contract',
    'examples',
    'connector-claude-conformance-manifest.yaml'
  );
  const claudeEntry = adapters.find(entry => entry.adapter === 'claude');
  if (claudeEntry && existsSync(connectorExamplePath)) {
    outputs.push({
      filePath: connectorExamplePath,
      contents: projectConformanceManifest({
        manifestText: readFileSync(connectorExamplePath, 'utf8'),
        contractVersion,
        ...claudeEntry
      })
    });
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

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
