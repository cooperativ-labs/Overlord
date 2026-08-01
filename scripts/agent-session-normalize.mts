/**
 * Fixture helper: run a connector-owned codec through the pure normalizer and print the result.
 *
 * This exists so the `normalized-event` fixture kind can execute the *real* interpreter rather
 * than a re-implementation of it. A fixture that asserted against a copy of the normalization
 * rules would pass forever while the shipped code drifted underneath it, which is the exact
 * failure the descriptor system was built to eliminate.
 *
 * It is spawned by `scripts/harness-capability-fixtures.mjs` with a JSON request on stdin and
 * performs no network or filesystem access beyond reading the named codec spec.
 */
import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';

import { type CodecSpec, normalizeNativeEvent } from '../packages/core/service/agent-session/pure/codec.ts';

type Request = {
  codecPath: string;
  payload: unknown;
  nativeEventName?: string | null;
  occurredAt?: string;
};

const request = JSON.parse(readFileSync(0, 'utf8')) as Request;
const codec = parseYaml(readFileSync(request.codecPath, 'utf8')) as CodecSpec;

const event = normalizeNativeEvent({
  codec,
  payload: request.payload,
  nativeEventName: request.nativeEventName ?? null,
  occurredAt: request.occurredAt ?? '2026-01-01T00:00:00.000Z'
});

process.stdout.write(JSON.stringify(event));
