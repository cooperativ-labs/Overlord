import { getReadableForeground, parseHexColor } from '@/lib/helpers/color';

export type CalendarTicketColors = {
  backgroundColor: string | undefined;
  borderColor: string | undefined;
  color: string | undefined;
  checkboxBorderColor: string | undefined;
  checkboxBackgroundColor: string | undefined;
};

/**
 * Derives the background/border/foreground (and checkbox) colors for a calendar
 * ticket chip from its project color. Returns all-`undefined` when there is no
 * project color (callers fall back to default accent styling), and a readable
 * foreground computed from the project color's luminance otherwise.
 */
export function getCalendarTicketColors(
  projectColor: string | null | undefined
): CalendarTicketColors {
  if (!projectColor) {
    return {
      backgroundColor: undefined,
      borderColor: undefined,
      color: undefined,
      checkboxBorderColor: undefined,
      checkboxBackgroundColor: undefined
    };
  }

  const rgb = parseHexColor(projectColor);
  if (!rgb) {
    return {
      backgroundColor: projectColor,
      borderColor: projectColor,
      color: '#111827',
      checkboxBorderColor: 'rgba(17, 24, 39, 0.35)',
      checkboxBackgroundColor: 'rgba(255, 255, 255, 0.18)'
    };
  }

  const foreground = getReadableForeground(rgb);
  const checkboxBorderColor =
    foreground === '#111827' ? 'rgba(17, 24, 39, 0.35)' : 'rgba(255, 255, 255, 0.45)';
  const checkboxBackgroundColor =
    foreground === '#111827' ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.12)';

  return {
    backgroundColor: projectColor,
    borderColor: projectColor,
    color: foreground,
    checkboxBorderColor,
    checkboxBackgroundColor
  };
}
