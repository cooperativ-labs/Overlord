import { reduceUrl } from '../redact.js';

import {
  type DescribeInput,
  type Description,
  normalizeMarkers,
  type RiskMarker
} from './types.js';

/**
 * The fetch formatter — scheme, host, path, and nothing else.
 *
 * The query string is dropped unconditionally by `reduceUrl`, because query parameters
 * routinely carry signed URLs, session tokens, and access keys. The card says so when it
 * happens: "query stripped" tells a reader that the URL they are approving is not the whole URL,
 * which is honest, whereas silently showing a shortened URL as if it were complete is not.
 */
export function describeFetch({ input }: DescribeInput): Description {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const raw =
    (typeof record.url === 'string' && record.url) ||
    (typeof record.uri === 'string' && record.uri) ||
    (typeof record.endpoint === 'string' && record.endpoint) ||
    null;
  const url = reduceUrl(raw);

  const markers: (RiskMarker | false | undefined)[] = ['network-egress'];
  // Plain HTTP to anything but a loopback host means credentials and responses cross the
  // network in the clear; that is a property of the request, decidable from structure.
  if (
    url?.scheme === 'http' &&
    url.host &&
    !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(url.host)
  ) {
    markers.push('secret-adjacent');
  }

  return {
    action: 'Fetch a URL',
    subject: url?.host ?? null,
    detail: url ? `${url.display}${url.hadQuery ? ' (query stripped)' : ''}` : null,
    riskMarkers: normalizeMarkers(markers)
  };
}
