export const PROJECT_SSH_PREFERENCE_SELECT =
  'project_id,ssh_command,remote_working_directory,ssh_host,ssh_port,ssh_user,ssh_auth_method,ssh_private_key_path';

/**
 * Fields on project_user that used to live on projects before multi-user
 * collaboration was introduced.
 */
export const PROJECT_USER_LOCAL_SELECT =
  'project_id,local_working_directory,remote_helper_installed_at,remote_helper_version';

export const PROJECT_BASE_SELECT = 'id,name,color,organization_id,everhour_project_id';
