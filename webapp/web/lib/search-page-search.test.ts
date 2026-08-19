import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSearchPageSearch } from './search-page-search.ts';

test('search page URL state trims a query and rejects non-string values', () => {
  assert.deepEqual(parseSearchPageSearch({ q: '  grouped results  ' }), { q: 'grouped results' });
  assert.deepEqual(parseSearchPageSearch({ q: ['grouped'] }), {});
  assert.deepEqual(parseSearchPageSearch({ q: '   ' }), {});
});
