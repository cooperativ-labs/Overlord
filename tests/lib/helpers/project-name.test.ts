import {
  isProjectNameUniqueViolation,
  PROJECT_NAME_CONFLICT_MESSAGE,
  projectNameConflictError
} from '@/lib/helpers/project-name';

describe('project-name helpers', () => {
  it('detects unique violation errors', () => {
    expect(isProjectNameUniqueViolation({ code: '23505' })).toBe(true);
    expect(isProjectNameUniqueViolation({ code: '42P01' })).toBe(false);
    expect(isProjectNameUniqueViolation(null)).toBe(false);
  });

  it('maps unique violations to a user-facing message', () => {
    const error = projectNameConflictError({ code: '23505' }, 'Failed to create project.');
    expect(error.message).toBe(PROJECT_NAME_CONFLICT_MESSAGE);
  });

  it('preserves other database errors', () => {
    const error = projectNameConflictError(
      { code: '42501', message: 'permission denied' },
      'Failed to create project.'
    );
    expect(error.message).toBe('permission denied');
  });
});
