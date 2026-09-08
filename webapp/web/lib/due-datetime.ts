export function parseDueDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromDateInputValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

export function buildDueDatetime({
  selectedDate,
  currentDueDatetime
}: {
  selectedDate: Date;
  currentDueDatetime: string | null;
}): string {
  if (currentDueDatetime) {
    const current = new Date(currentDueDatetime);
    const next = new Date(current);
    next.setUTCFullYear(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate()
    );
    return next.toISOString();
  }

  return new Date(
    Date.UTC(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 12, 0, 0)
  ).toISOString();
}

/**
 * Trigger label for a due-date control: `Due Mar 4, 2026` once a date is set,
 * otherwise the caller's empty label (`Set due date`, `Due date`, …).
 */
export function formatDueDateLabel(value: string | null, emptyLabel: string): string {
  const date = parseDueDate(value);
  if (!date) return emptyLabel;
  return `Due ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date)}`;
}

/** `1st` / `22nd` / `13th` for the compact due-date pill on list rows. */
export function formatOrdinalDayOfMonth(date: Date): string {
  const day = date.getDate();
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}
