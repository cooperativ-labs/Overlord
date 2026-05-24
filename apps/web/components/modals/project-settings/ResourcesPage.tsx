'use client';

import { DeviceResourceList } from '@/components/features/projects/DeviceResourceList';
import type { ProjectSshAuthMethod } from '@/lib/actions/project-types';

import { SshWorkspaceSection } from './SshWorkspaceSection';

type ResourcesPageProps = {
  open: boolean;
  projectId: string;
  initialSshHost: string | null;
  initialSshPort: number | null;
  initialSshUser: string | null;
  initialSshAuthMethod: ProjectSshAuthMethod | null;
  initialSshPrivateKeyPath: string | null;
  initialRemoteWorkingDirectory: string | null;
  sshFeatureEnabled: boolean;
};

export function ResourcesPage({
  open,
  projectId,
  initialSshHost,
  initialSshPort,
  initialSshUser,
  initialSshAuthMethod,
  initialSshPrivateKeyPath,
  initialRemoteWorkingDirectory,
  sshFeatureEnabled
}: ResourcesPageProps) {
  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <DeviceResourceList open={open} projectId={projectId} />
      </section>

      {sshFeatureEnabled ? (
        <section className="grid gap-3">
          <SshWorkspaceSection
            projectId={projectId}
            initialSshHost={initialSshHost}
            initialSshPort={initialSshPort}
            initialSshUser={initialSshUser}
            initialSshAuthMethod={initialSshAuthMethod}
            initialSshPrivateKeyPath={initialSshPrivateKeyPath}
            initialRemoteWorkingDirectory={initialRemoteWorkingDirectory}
          />
        </section>
      ) : null}
    </div>
  );
}
