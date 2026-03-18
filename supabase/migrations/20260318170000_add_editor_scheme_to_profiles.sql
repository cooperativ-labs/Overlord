-- Store the preferred IDE/editor for opening file links from ticket artifacts.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS editor_scheme text NOT NULL DEFAULT 'vscode';

COMMENT ON COLUMN profiles.editor_scheme IS
  'Preferred editor for opening file links from tickets. Supported values include vscode, cursor, and jetbrains.';
