const mockCreateProject = jest.fn();
const mockAddProjectResourceDirectoryAction = jest.fn();
const mockCreateClientForRequest = jest.fn();
const mockCaptureException = jest.fn();

jest.mock('@/lib/actions/projects', () => ({
  createProject: (...args: unknown[]) => mockCreateProject(...args)
}));

jest.mock('@/lib/actions/resource-directories', () => ({
  addProjectResourceDirectoryAction: (...args: unknown[]) =>
    mockAddProjectResourceDirectoryAction(...args)
}));

jest.mock('@/supabase/utils/server', () => ({
  createClientForRequest: (...args: unknown[]) => mockCreateClientForRequest(...args)
}));

jest.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args)
}));

import { createFirstProjectWithDirectory } from '@/lib/actions/onboarding';

describe('createFirstProjectWithDirectory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers the initial directory as a primary resource without syncing the removed legacy field', async () => {
    mockCreateProject.mockResolvedValue({
      id: 'project-1',
      organizationId: 42
    });

    await createFirstProjectWithDirectory({
      organizationId: 42,
      name: 'Agent orchestration',
      color: '#112233',
      workingDirectory: '/workspace/Overlord',
      deviceFingerprint: 'device-fingerprint',
      deviceHostname: 'codex-mac',
      devicePlatform: 'darwin'
    });

    expect(mockCreateClientForRequest).not.toHaveBeenCalled();
    expect(mockCreateProject).toHaveBeenCalledWith({
      organizationId: 42,
      name: 'Agent orchestration',
      color: '#112233'
    });
    expect(mockAddProjectResourceDirectoryAction).toHaveBeenCalledWith({
      projectId: 'project-1',
      directoryPath: '/workspace/Overlord',
      isPrimary: true,
      deviceFingerprint: 'device-fingerprint',
      deviceHostname: 'codex-mac',
      devicePlatform: 'darwin'
    });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
