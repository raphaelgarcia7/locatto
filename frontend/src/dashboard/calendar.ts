import { addDays } from './api';

export type CalendarView = 'month' | 'week';

export function calendarDates(anchor: string, view: CalendarView): string[] {
  const date = new Date(`${anchor}T12:00:00Z`);
  if (view === 'week') {
    const monday = addDays(anchor, -((date.getUTCDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const count = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return Array.from({ length: count }, (_, index) => addDays(first, index));
}

export function calendarMonths(anchor: string, view: CalendarView): string[] {
  return [
    ...new Set(calendarDates(anchor, view).map((date) => date.slice(0, 7))),
  ];
}

export function moveCalendar(
  anchor: string,
  view: CalendarView,
  direction: number,
): string {
  if (view === 'week') return addDays(anchor, direction * 7);
  const date = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}
