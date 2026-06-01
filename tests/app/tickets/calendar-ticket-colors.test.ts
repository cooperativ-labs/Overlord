import { getCalendarTicketColors } from '@/app/(app)/tickets/(components)/calendar/calendar-ticket-colors';

describe('getCalendarTicketColors', () => {
  it('returns all-undefined when there is no project color', () => {
    expect(getCalendarTicketColors(null)).toEqual({
      backgroundColor: undefined,
      borderColor: undefined,
      color: undefined,
      checkboxBorderColor: undefined,
      checkboxBackgroundColor: undefined
    });
    expect(getCalendarTicketColors(undefined)).toEqual({
      backgroundColor: undefined,
      borderColor: undefined,
      color: undefined,
      checkboxBorderColor: undefined,
      checkboxBackgroundColor: undefined
    });
  });

  it('falls back to a dark foreground for an unparseable color', () => {
    expect(getCalendarTicketColors('not-a-color')).toEqual({
      backgroundColor: 'not-a-color',
      borderColor: 'not-a-color',
      color: '#111827',
      checkboxBorderColor: 'rgba(17, 24, 39, 0.35)',
      checkboxBackgroundColor: 'rgba(255, 255, 255, 0.18)'
    });
  });

  it('uses a light foreground (and matching checkbox colors) on a dark project color', () => {
    const colors = getCalendarTicketColors('#000000');
    expect(colors.backgroundColor).toBe('#000000');
    expect(colors.borderColor).toBe('#000000');
    expect(colors.color).toBe('#ffffff');
    expect(colors.checkboxBorderColor).toBe('rgba(255, 255, 255, 0.45)');
    expect(colors.checkboxBackgroundColor).toBe('rgba(255, 255, 255, 0.12)');
  });

  it('uses a dark foreground (and matching checkbox colors) on a light project color', () => {
    const colors = getCalendarTicketColors('#ffffff');
    expect(colors.color).toBe('#111827');
    expect(colors.checkboxBorderColor).toBe('rgba(17, 24, 39, 0.35)');
    expect(colors.checkboxBackgroundColor).toBe('rgba(255, 255, 255, 0.18)');
  });
});
