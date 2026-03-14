export const WORKING_DIRECTORY_NONE = '__none__';

export function isWorkingDirectoryNone(value: string | null): boolean {
  return value === WORKING_DIRECTORY_NONE;
}
