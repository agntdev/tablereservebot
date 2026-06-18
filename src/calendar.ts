import { InlineKeyboardMarkup, inlineButton, inlineKeyboard } from "./toolkit/index.js";

export interface CalendarDay {
  date: string;
  label: string;
  dayOfWeek: string;
}

export interface CalendarWeek {
  days: CalendarDay[];
  keyboard: InlineKeyboardMarkup;
  prevStart: string;
  nextStart: string;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildCalendarWeek(startDateStr: string): CalendarWeek {
  const start = new Date(startDateStr + "T00:00:00Z");

  const prevStart = new Date(start);
  prevStart.setUTCDate(prevStart.getUTCDate() - 7);

  const nextStart = new Date(start);
  nextStart.setUTCDate(nextStart.getUTCDate() + 7);

  const days: CalendarDay[] = [];
  const d = new Date(start);
  for (let i = 0; i < 7; i++) {
    const ds = d.toISOString().slice(0, 10);
    const dayName = DAY_NAMES[d.getUTCDay()];
    const month = d.getUTCMonth() + 1;
    const dayNum = d.getUTCDate();
    const label = `${dayName} ${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    days.push({ date: ds, label, dayOfWeek: dayName });
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const dayRows = days.map((day) => [inlineButton(day.label, `cal:pick:${day.date}`)]);

  const navRow = [];
  const prevStr = prevStart.toISOString().slice(0, 10);
  const nextStr = nextStart.toISOString().slice(0, 10);
  const today = todayStr();

  if (prevStr >= today) {
    navRow.push(inlineButton("« Prev", `cal:prev:${prevStr}`));
  }
  navRow.push(inlineButton("Next »", `cal:next:${nextStr}`));

  const rows = dayRows.concat(navRow.length > 0 ? [navRow] : []);

  return {
    days,
    keyboard: inlineKeyboard(rows),
    prevStart: prevStr,
    nextStart: nextStr,
  };
}
