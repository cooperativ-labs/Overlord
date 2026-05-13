import {
  applyMarkdownListContinuation,
  matchesListContinuationKey
} from '@/lib/helpers/list-continuation';

describe('matchesListContinuationKey', () => {
  it('matches Enter for enter mode', () => {
    expect(matchesListContinuationKey({ mode: 'enter', key: 'Enter', shiftKey: false })).toBe(true);
    expect(matchesListContinuationKey({ mode: 'enter', key: 'Enter', shiftKey: true })).toBe(true);
  });

  it('matches only Shift+Enter for shift-enter mode', () => {
    expect(matchesListContinuationKey({ mode: 'shift-enter', key: 'Enter', shiftKey: false })).toBe(
      false
    );
    expect(matchesListContinuationKey({ mode: 'shift-enter', key: 'Enter', shiftKey: true })).toBe(
      true
    );
  });
});

describe('applyMarkdownListContinuation', () => {
  it('continues ordered lists', () => {
    const value = '1. first';
    const pos = value.length;
    const r = applyMarkdownListContinuation({
      value,
      selectionStart: pos,
      selectionEnd: pos
    });
    expect(r.applied).toBe(true);
    if (r.applied) {
      expect(r.nextValue).toBe('1. first\n2. ');
      expect(r.nextSelection).toBe(r.nextValue.length);
    }
  });

  it('continues bullet lists', () => {
    const value = '- item';
    const pos = value.length;
    const r = applyMarkdownListContinuation({
      value,
      selectionStart: pos,
      selectionEnd: pos
    });
    expect(r.applied).toBe(true);
    if (r.applied) {
      expect(r.nextValue).toBe('- item\n- ');
    }
  });

  it('clears an empty ordered list line', () => {
    const value = 'intro\n1. ';
    const pos = value.length;
    const r = applyMarkdownListContinuation({
      value,
      selectionStart: pos,
      selectionEnd: pos
    });
    expect(r.applied).toBe(true);
    if (r.applied) {
      expect(r.nextValue).toBe('intro\n');
      expect(r.nextSelection).toBe('intro\n'.length);
    }
  });

  it('clears an empty bullet line', () => {
    const value = '- ';
    const pos = value.length;
    const r = applyMarkdownListContinuation({
      value,
      selectionStart: pos,
      selectionEnd: pos
    });
    expect(r.applied).toBe(true);
    if (r.applied) {
      expect(r.nextValue).toBe('');
      expect(r.nextSelection).toBe(0);
    }
  });

  it('does not apply for a non-list line', () => {
    const value = 'plain text';
    const pos = value.length;
    expect(
      applyMarkdownListContinuation({
        value,
        selectionStart: pos,
        selectionEnd: pos
      }).applied
    ).toBe(false);
  });

  it('does not apply when selection spans text', () => {
    const value = '1. a';
    expect(
      applyMarkdownListContinuation({
        value,
        selectionStart: 0,
        selectionEnd: value.length
      }).applied
    ).toBe(false);
  });

  it('preserves leading whitespace when continuing ordered lists', () => {
    const value = '  1. first';
    const pos = value.length;
    const r = applyMarkdownListContinuation({
      value,
      selectionStart: pos,
      selectionEnd: pos
    });
    expect(r.applied).toBe(true);
    if (r.applied) {
      expect(r.nextValue).toBe('  1. first\n  2. ');
    }
  });

  it('preserves leading whitespace when continuing bullet lists', () => {
    const value = '\t- item';
    const pos = value.length;
    const r = applyMarkdownListContinuation({
      value,
      selectionStart: pos,
      selectionEnd: pos
    });
    expect(r.applied).toBe(true);
    if (r.applied) {
      expect(r.nextValue).toBe('\t- item\n\t- ');
    }
  });

  it('clears an empty indented ordered list line', () => {
    const value = 'x\n  1. ';
    const pos = value.length;
    const r = applyMarkdownListContinuation({
      value,
      selectionStart: pos,
      selectionEnd: pos
    });
    expect(r.applied).toBe(true);
    if (r.applied) {
      expect(r.nextValue).toBe('x\n');
    }
  });
});
