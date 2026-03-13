export type TextareaHandle = {
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
  value: string;
};

export type EditableTextareaHandle = TextareaHandle & {
  scrollHeight: number;
  selectionEnd: number | null;
  selectionStart: number | null;
  style: {
    height: string;
  };
};

export type SelectableTextareaHandle = TextareaHandle & {
  select: () => void;
};
