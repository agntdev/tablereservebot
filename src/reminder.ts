import type { Storage } from "./storage/index.js";
import { formatDateStr } from "./tz.js";

export interface ReminderApi {
  sendMessage(chat_id: number, text: string): Promise<unknown>;
}

export interface ReminderResult {
  sent: number;
  checked: number;
}

function getTimezoneOffsetMs(timezone: string, date: Date): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
      hour12: false,
    });
    const formatted = formatter.format(date);
    const match = formatted.match(/GMT([+-]\d{2}):?(\d{2})/);
    if (!match) return 0;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const sign = hours >= 0 ? 1 : -1;
    return (Math.abs(hours) * 3600 + minutes * 60) * 1000 * sign;
  } catch {
    return 0;
  }
}

function toUtcTimestamp(dateStr: string, timeStr: string, timezone: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetMs = getTimezoneOffsetMs(timezone, new Date(naiveUtc));
  return naiveUtc - offsetMs;
}

export async function checkAndSendReminders(
  storage: Storage,
  api: ReminderApi,
  now: Date = new Date(),
): Promise<ReminderResult> {
  const settings = await storage.getSettings();
  if (!settings) return { sent: 0, checked: 0 };

  const leadTimeMs = settings.reminder_lead_time * 60 * 1000;
  const todayStr = formatDateStr(now, settings.timezone);

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = formatDateStr(tomorrow, settings.timezone);

  const dates = [todayStr, tomorrowStr];
  let sent = 0;
  let checked = 0;

  for (const date of dates) {
    const bookings = await storage.listBookingsByDate(date);
    for (const booking of bookings) {
      if (booking.status !== "confirmed") continue;
      if (!booking.guest_telegram_id) continue;

      checked++;

      const alreadyReminded = await storage.hasReminderSent(booking.id);
      if (alreadyReminded) continue;

      const bookingTs = toUtcTimestamp(booking.date, booking.start_time, settings.timezone);
      const timeUntilMs = bookingTs - now.getTime();

      if (timeUntilMs <= 0) continue;
      if (timeUntilMs > leadTimeMs) continue;

      const minsUntil = Math.round(timeUntilMs / 60000);

      await api.sendMessage(
        booking.guest_telegram_id,
        `⏰ Reminder: You have a reservation in ${minsUntil} minutes.\n\n` +
          `Ref: ${booking.ref_code}\n` +
          `Date: ${booking.date}\n` +
          `Time: ${booking.start_time}–${booking.end_time}\n` +
          `Party: ${booking.party_size} guests\n\n` +
          `Use /booking ${booking.ref_code} to view details.`,
      );

      await storage.markReminderSent(booking.id);
      sent++;
    }
  }

  return { sent, checked };
}
