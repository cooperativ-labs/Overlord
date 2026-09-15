import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatDate, formatDateTime, formatTimestamp, relativeTime } from './format-date.ts';

test('date formatters use an em-dash for missing or invalid values', () => {
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate('invalid'), '—');
  assert.equal(formatDateTime(undefined), '—');
  assert.equal(formatDateTime('invalid'), '—');
});

test('formatTimestamp preserves invalid raw values for diagnostic surfaces', () => {
  assert.equal(formatTimestamp('invalid'), 'invalid');
});

test('relativeTime uses the supplied clock and supports display-specific fallbacks', () => {
  assert.equal(relativeTime('2026-08-17T11:59:30.000Z', '2026-08-17T12:00:00.000Z'), '30s ago');
  assert.equal(relativeTime(null, '2026-08-17T12:00:00.000Z', { missing: 'never' }), 'never');
  assert.equal(
    relativeTime('invalid', '2026-08-17T12:00:00.000Z', { invalid: 'unknown' }),
    'unknown'
  );
  assert.equal(
    relativeTime('2026-08-17T11:59:30.000Z', '2026-08-17T12:00:00.000Z', {
      immediate: 'just now',
      rounding: 'floor'
    }),
    'just now'
  );
});
