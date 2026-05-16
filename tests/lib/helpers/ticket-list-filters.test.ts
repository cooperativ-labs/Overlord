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

  it('normalizes filter payloads with project id list', () => {
    expect(
      normalizeTicketListFilters({
        selected_statuses: [' draft ', 'review', 'review'],
        filter_project_ids: ['  a  ', 'b', 'a']
      })
    ).toEqual({
      selected_statuses: ['draft', 'review'],
      filter_project_ids: ['a', 'b'],
      filter_tag_ids: []
    });
  });

  it('migrates legacy single filter_project_id into filter_project_ids', () => {
    expect(
      normalizeTicketListFilters({
        selected_statuses: ['execute'],
        filter_project_id: '  project-123  '
      })
    ).toEqual({
      selected_statuses: ['execute'],
      filter_project_ids: ['project-123'],
      filter_tag_ids: []
    });
  });

  it('prefers filter_project_ids over legacy id when both are present', () => {
    expect(
      normalizeTicketListFilters({
        filter_project_ids: ['p1'],
        filter_project_id: 'p2'
      })
    ).toEqual({
      selected_statuses: [],
      filter_project_ids: ['p1'],
      filter_tag_ids: []
    });
  });

  it('parses invalid values to defaults', () => {
    expect(
      parseTicketListFilters({ selected_statuses: ['execute'], filter_project_id: 1 })
    ).toEqual({
      selected_statuses: ['execute'],
      filter_project_ids: [],
      filter_tag_ids: []
    });
    expect(parseTicketListFilters(null)).toEqual({
      selected_statuses: [],
      filter_project_ids: [],
      filter_tag_ids: []
    });
  });

  it('normalizes tag filters by trimming, deduplicating, and defaulting invalid values', () => {
    expect(
      normalizeTicketListFilters({
        filter_tag_ids: ['  tag-1  ', 'tag-2', 'tag-1', '', 42]
      })
    ).toEqual({
      selected_statuses: [],
      filter_project_ids: [],
      filter_tag_ids: ['tag-1', 'tag-2']
    });

    expect(parseTicketListFilters({ filter_tag_ids: 'tag-1' })).toEqual({
      selected_statuses: [],
      filter_project_ids: [],
      filter_tag_ids: []
    });
  });
});
