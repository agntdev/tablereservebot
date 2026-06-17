import {
  inlineButton,
  inlineKeyboard,
  type InlineButton,
  type InlineKeyboardMarkup,
} from "./toolkit/index.js";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Build a calendar inline keyboard for a given year and month (0-based).
 * Includes a date grid with navigation controls.
 */
export function buildCalendar(
  year: number,
  month: number,
): { text: string; keyboard: InlineKeyboardMarkup } {
  const monthName = MONTH_NAMES[month];
  const text = `📅 ${monthName} ${year}\nSelect a date:`;

  const firstDay = new Date(year, month, 1).getDay();
  const startDay = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const rows: InlineButton[][] = [];
  let day = 1;

  for (let week = 0; week < 6; week++) {
    const row: InlineButton[] = [];
    for (let dow = 0; dow < 7; dow++) {
      if ((week === 0 && dow < startDay) || day > daysInMonth) {
        row.push(inlineButton(" ", "cal:ignore"));
      } else {
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        row.push(inlineButton(String(day), `cal:pick:${dateStr}`));
        day++;
      }
    }
    rows.push(row);
    if (day > daysInMonth) break;
  }

  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;

  rows.push([
    inlineButton("◀ Prev", `cal:nav:${prevYear}:${prevMonth}`),
    inlineButton("Next ▶", `cal:nav:${nextYear}:${nextMonth}`),
  ]);

  return { text, keyboard: inlineKeyboard(rows) };
}