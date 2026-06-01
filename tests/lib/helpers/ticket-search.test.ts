import { normalizeTicketSearchQuery } from '@/lib/helpers/ticket-search';

describe('normalizeTicketSearchQuery', () => {
  it('sanitizes unsafe characters and collapses whitespace', () => {
    expect(normalizeTicketSearchQuery('  auth!!  refactor  ')).toEqual({
      sanitized: 'auth refactor',
      rawTrimmed: 'auth!!  refactor',
      exactTicketId: null,
      textSearchQuery: 'auth* refactor*'
    });
  });

  it('preserves exact ticket identifiers for RPC matching', () => {
    expect(normalizeTicketSearchQuery('1:1150')).toEqual({
      sanitized: '1 1150',
      rawTrimmed: '1:1150',
      exactTicketId: '1:1150',
      textSearchQuery: '1* 1150*'
    });
  });
});
