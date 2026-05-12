export type AutoListContinuationMode = 'enter' | 'shift-enter';

export function matchesListContinuationKey({
  mode,
  key,
  shiftKey
}: {
  mode: AutoListContinuationMode;
  key: string;
  shiftKey: boolean;
}): boolean {
  if (key !== 'Enter') return false;
  return mode === 'enter' ? true : shiftKey;
}

/**
 * Continue markdown-style ordered (`1. `) or bullet (`- ` / `* `) lists on newline,
 * or remove an empty list marker when Enter is pressed on a blank list line.
 */
export function applyMarkdownListContinuation({
  value,
  selectionStart,
  selectionEnd
}: {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}): { applied: true; nextValue: string; nextSelection: number } | { applied: false } {
  if (selectionStart !== selectionEnd) {
    return { applied: false };
  }

  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const lineStart = before.lastIndexOf('\n') + 1;
  const line = before.slice(lineStart);

  if (/^\d+\.\s*$/.test(line)) {
    return {
      applied: true,
      nextValue: before.slice(0, lineStart) + after,
      nextSelection: lineStart
    };
  }

  if (/^[-*]\s*$/.test(line)) {
    return {
      applied: true,
      nextValue: before.slice(0, lineStart) + after,
      nextSelection: lineStart
    };
  }

  const ordered = line.match(/^(\d+)\.\s+(\S[\s\S]*)$/);
  if (ordered) {
    const n = parseInt(ordered[1], 10);
    if (Number.isNaN(n)) {
      return { applied: false };
    }
    const insert = `\n${n + 1}. `;
    return {
      applied: true,
      nextValue: before + insert + after,
      nextSelection: selectionStart + insert.length
    };
  }

  const bullet = line.match(/^([-*])\s+(\S[\s\S]*)$/);
  if (bullet) {
    const marker = bullet[1];
    const insert = `\n${marker} `;
    return {
      applied: true,
      nextValue: before + insert + after,
      nextSelection: selectionStart + insert.length
    };
  }

  return { applied: false };
}
