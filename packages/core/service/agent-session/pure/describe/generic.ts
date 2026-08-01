import { topLevelKeys } from '../redact.js';
import { safeText } from '../text.js';

import { type DescribeInput, type Description, normalizeMarkers } from './types.js';

/**
 * The default formatter: tool name plus the top-level keys of its input. Nothing else.
 *
 * This is the whole default-deny property, and it exists because harnesses will always add
 * tools faster than we write formatters for them. A new tool that Overlord has never heard of
 * leaks nothing until someone deliberately decides, in a reviewable diff, what is safe to show
 * from it. Key names are structural; values are content.
 *
 * It is also the fallback when a formatter throws. A formatter failure must degrade to a card
 * that is still decidable and still safe — never to raw passthrough, and never to failing the
 * decision, since a thrown exception in a summarizer must not be able to block an agent.
 */
export function describeGeneric({ tool, input }: DescribeInput): Description {
  const { keys, truncated } = topLevelKeys(input);
  const name = safeText(tool, 80).text || 'unknown';
  return {
    action: 'Use a tool',
    subject: name,
    detail: keys.length > 0 ? `input keys: ${keys.join(', ')}${truncated ? ', …' : ''}` : null,
    riskMarkers: normalizeMarkers([truncated && 'truncated']),
    keys
  };
}
