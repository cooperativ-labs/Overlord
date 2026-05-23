/**
 * Fields on project_user that belong to the current user's local setup for a
 * project. SSH/remote settings now live in execution_targets,
 * execution_target_ssh_credentials, and project_resource_directories.
 */
export const PROJECT_USER_LOCAL_SELECT = 'project_id,local_working_directory';

export const PROJECT_BASE_SELECT =
  'id,name,color,organization_id,everhour_project_id,operations_profile_fingerprint,operations_profile_generated_at';
