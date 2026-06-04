export const PROJECT_NAME_CONFLICT_MESSAGE =
  'A project with this name already exists in this organization.';

export function isProjectNameUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

export function projectNameConflictError(
  error: { code?: string; message?: string } | null | undefined,
  fallbackMessage: string
): Error {
  if (isProjectNameUniqueViolation(error)) {
    return new Error(PROJECT_NAME_CONFLICT_MESSAGE);
  }

  return new Error(error?.message ?? fallbackMessage);
}
