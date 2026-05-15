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

  it('registers the initial directory as a resource and keeps the legacy working-directory field in sync', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const getUser = jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const supabase = {
      auth: { getUser },
      from: jest.fn().mockReturnValue({ upsert })
    } as never;

    mockCreateClientForRequest.mockResolvedValue(supabase);
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
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        project_id: 'project-1',
        local_working_directory: '/workspace/Overlord',
        updated_at: expect.any(String)
      },
      { onConflict: 'user_id,project_id' }
    );
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
