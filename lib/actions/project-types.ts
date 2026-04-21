import type { Database } from '@/types/database.types';

export type ProjectSshAuthMethod = 'agent' | 'key' | 'tailscale';

export type SidebarProject = {
  id: string;
  name: string;
  color: string;
  organizationId: number;
  localWorkingDirectory: string | null;
  /** @deprecated — retained for one release so legacy callers keep compiling. */
  sshCommand: string | null;
  remoteWorkingDirectory: string | null;
  sshHost: string | null;
  sshPort: number | null;
  sshUser: string | null;
  sshAuthMethod: ProjectSshAuthMethod | null;
  sshPrivateKeyPath: string | null;
  remoteHelperInstalledAt: string | null;
  remoteHelperVersion: string | null;
};

export type CreateProjectResult = {
  id: string;
  name: string;
  color: string;
  organizationId: number;
};

export type UpdateProjectSshConfigInput = {
  projectId: string;
  remoteWorkingDirectory: string | null;
  sshHost: string | null;
  sshPort: number | null;
  sshUser: string | null;
  sshAuthMethod: ProjectSshAuthMethod | null;
  sshPrivateKeyPath: string | null;
};

type ProjectUserRow = Database['public']['Tables']['project_user']['Row'];
export type ProjectUserSshSettingsRow = Pick<
  ProjectUserRow,
  | 'project_id'
  | 'ssh_command'
  | 'remote_working_directory'
  | 'ssh_host'
  | 'ssh_port'
  | 'ssh_user'
  | 'ssh_auth_method'
  | 'ssh_private_key_path'
>;
type ProjectSshSettings = Pick<
  SidebarProject,
  | 'sshCommand'
  | 'remoteWorkingDirectory'
  | 'sshHost'
  | 'sshPort'
  | 'sshUser'
  | 'sshAuthMethod'
  | 'sshPrivateKeyPath'
>;

function trimString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildLegacySshCommandFromFields(input: {
  sshHost: string | null;
  sshPort: number | null;
  sshUser: string | null;
}): string | null {
  const user = trimString(input.sshUser);
  const host = trimString(input.sshHost);
  if (!user || !host) return null;
  const port = input.sshPort && input.sshPort !== 22 ? ` -p ${input.sshPort}` : '';
  return `ssh${port} ${user}@${host}`;
}

function normalizeProjectSshSettings(input: {
  sshCommand: string | null | undefined;
  remoteWorkingDirectory: string | null | undefined;
  sshHost: string | null | undefined;
  sshPort: number | null | undefined;
  sshUser: string | null | undefined;
  sshAuthMethod: string | null | undefined;
  sshPrivateKeyPath: string | null | undefined;
}): ProjectSshSettings {
  const sshHost = trimString(input.sshHost);
  const sshUser = trimString(input.sshUser);
  const sshPort = input.sshPort ?? null;
  const sshCommand =
    trimString(input.sshCommand) ?? buildLegacySshCommandFromFields({ sshHost, sshPort, sshUser });

  return {
    sshCommand,
    remoteWorkingDirectory: trimString(input.remoteWorkingDirectory),
    sshHost,
    sshPort,
    sshUser,
    sshAuthMethod: input.sshAuthMethod as ProjectSshAuthMethod | null,
    sshPrivateKeyPath: trimString(input.sshPrivateKeyPath)
  };
}

export function resolveProjectUserSshSettings(
  projectUser?: Pick<
    ProjectUserSshSettingsRow,
    | 'ssh_command'
    | 'remote_working_directory'
    | 'ssh_host'
    | 'ssh_port'
    | 'ssh_user'
    | 'ssh_auth_method'
    | 'ssh_private_key_path'
  > | null
): ProjectSshSettings {
  return normalizeProjectSshSettings({
    sshCommand: projectUser?.ssh_command,
    remoteWorkingDirectory: projectUser?.remote_working_directory,
    sshHost: projectUser?.ssh_host,
    sshPort: projectUser?.ssh_port,
    sshUser: projectUser?.ssh_user,
    sshAuthMethod: projectUser?.ssh_auth_method,
    sshPrivateKeyPath: projectUser?.ssh_private_key_path
  });
}

export function buildLegacySshCommand(input: UpdateProjectSshConfigInput): string | null {
  return buildLegacySshCommandFromFields(input);
}
