import {
  normalizeStringList,
  normalizeTicketListFilters,
  parseTicketListFilters
} from '@/lib/helpers/ticket-list-filters';

describe('ticket list filter helpers', () => {
  it('normalizes string lists by trimming, deduplicating, and dropping blanks', () => {
    expect(normalizeStringList([' draft ', 'execute', '', 'draft', 42, 'review'])).toEqual([
      'draft',
      'execute',
      'review'
    ]);
  });

  it('normalizes filter payloads', () => {
    expect(
      normalizeTicketListFilters({
        selected_statuses: [' draft ', 'review', 'review'],
        filter_project_id: '  project-123  '
      })
    ).toEqual({
      selected_statuses: ['draft', 'review'],
      filter_project_id: 'project-123'
    });
  });

  it('parses invalid values to defaults', () => {
    expect(
      parseTicketListFilters({ selected_statuses: ['execute'], filter_project_id: 1 })
    ).toEqual({
      selected_statuses: ['execute'],
      filter_project_id: null
    });
    expect(parseTicketListFilters(null)).toEqual({
      selected_statuses: [],
      filter_project_id: null
    });
  });
});
