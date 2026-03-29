-- Add SSH remote workspace support to projects.
-- ssh_command: the shell command to open an SSH connection (e.g. "ssh user@host")
-- remote_working_directory: the project path on the remote server
ALTER TABLE projects ADD COLUMN ssh_command text;
ALTER TABLE projects ADD COLUMN remote_working_directory text;
