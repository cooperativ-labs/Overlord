import { getEditorScheme } from '@/lib/env';
import { normalizeEditorScheme } from '@/lib/helpers/editor-scheme';

describe('editor scheme helpers', () => {
  const originalCodeEditor = process.env.CODE_EDITOR;

  afterEach(() => {
    if (originalCodeEditor === undefined) {
      delete process.env.CODE_EDITOR;
    } else {
      process.env.CODE_EDITOR = originalCodeEditor;
    }
  });

  it('maps named IDE values to file-link schemes', () => {
    expect(normalizeEditorScheme('vscode')).toBe('vscode://file');
    expect(normalizeEditorScheme('cursor')).toBe('cursor://file');
    expect(normalizeEditorScheme('jetbrains')).toBe('idea://open?file=');
  });

  it('accepts legacy JetBrains aliases', () => {
    expect(normalizeEditorScheme('webstorm')).toBe('idea://open?file=');
    expect(normalizeEditorScheme('idea')).toBe('idea://open?file=');
  });

  it('falls back to CODE_EDITOR when no preference is provided', () => {
    process.env.CODE_EDITOR = 'cursor';

    expect(getEditorScheme()).toBe('cursor://file');
  });
});
