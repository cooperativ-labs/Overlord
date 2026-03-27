export const DEFAULT_EDITOR_SCHEME = 'vscode';

export const EDITOR_SCHEME_OPTIONS = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'windsurf', label: 'Windsurf' },
  { value: 'zed', label: 'Zed' },
  { value: 'sublime', label: 'Sublime Text' },
  { value: 'textmate', label: 'TextMate' },
  { value: 'antigravity', label: 'Antigravity' },
  { value: 'jetbrains', label: 'JetBrains IDEs' }
] as const;

export type EditorSchemeValue = (typeof EDITOR_SCHEME_OPTIONS)[number]['value'];

const EDITOR_SCHEME_MAP: Record<EditorSchemeValue, string> = {
  vscode: 'vscode://file',
  cursor: 'cursor://file',
  windsurf: 'windsurf://file',
  zed: 'zed://file',
  sublime: 'subl://open?url=file://',
  textmate: 'txmt://open?url=file://',
  antigravity: 'antigravity://file',
  jetbrains: 'idea://open?file='
};

const LEGACY_EDITOR_SCHEME_MAP: Record<string, string> = {
  idea: EDITOR_SCHEME_MAP.jetbrains,
  intellij: EDITOR_SCHEME_MAP.jetbrains,
  phpstorm: EDITOR_SCHEME_MAP.jetbrains,
  webstorm: EDITOR_SCHEME_MAP.jetbrains
};

function isEditorSchemeValue(value: string): value is EditorSchemeValue {
  return value in EDITOR_SCHEME_MAP;
}

export function normalizeEditorScheme(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return EDITOR_SCHEME_MAP[DEFAULT_EDITOR_SCHEME];
  }

  const normalized = trimmed.toLowerCase();
  if (isEditorSchemeValue(normalized)) {
    return EDITOR_SCHEME_MAP[normalized];
  }

  if (normalized in LEGACY_EDITOR_SCHEME_MAP) {
    return LEGACY_EDITOR_SCHEME_MAP[normalized];
  }

  if (trimmed.includes('://')) {
    return trimmed;
  }

  return trimmed;
}

export function getEditorSchemeLabel(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 'VS Code';
  if (normalized === 'vscode' || normalized === 'vscode://file') return 'VS Code';
  if (normalized === 'cursor' || normalized === 'cursor://file') return 'Cursor';
  if (normalized === 'windsurf' || normalized === 'windsurf://file') return 'Windsurf';
  if (normalized === 'zed' || normalized === 'zed://file') return 'Zed';
  if (normalized === 'sublime' || normalized === 'subl://open?url=file://') return 'Sublime Text';
  if (normalized === 'textmate' || normalized === 'txmt://open?url=file://') return 'TextMate';
  if (normalized === 'antigravity' || normalized === 'antigravity://file') return 'Antigravity';
  if (
    normalized === 'jetbrains' ||
    normalized === 'idea' ||
    normalized === 'intellij' ||
    normalized === 'phpstorm' ||
    normalized === 'webstorm' ||
    normalized === 'idea://open?file='
  ) {
    return 'JetBrains IDEs';
  }

  return value?.trim() ?? 'VS Code';
}
