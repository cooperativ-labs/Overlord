/** Execute the real pure decision interpreter for a descriptor fixture. */
import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';

import {
  decodeDecisionRequest,
  type DecisionCodecSpec,
  encodeDecisionResponse
} from '../packages/core/service/agent-session/pure/decision.ts';

type Request = { codecPath: string; payload: unknown };

const request = JSON.parse(readFileSync(0, 'utf8')) as Request;
const codec = parseYaml(readFileSync(request.codecPath, 'utf8')) as DecisionCodecSpec;

process.stdout.write(
  JSON.stringify({
    request: decodeDecisionRequest(codec, request.payload),
    responses: {
      allow: encodeDecisionResponse(codec, 'allow'),
      deny: encodeDecisionResponse(codec, 'deny'),
      ask: encodeDecisionResponse(codec, 'ask')
    }
  })
);
