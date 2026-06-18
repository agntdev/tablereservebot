import type { Storage } from "./storage/index.js";

export interface ReminderApi {
  sendMessage(chat_id: number, text: string): Promise<unknown>;
}

export interface ReminderResult {
  sent: number;
  checked: number;
}

export async function checkAndSendReminders(
  storage: Storage,
  api: ReminderApi,
  now: Date = new Date(),
): Promise<ReminderResult> {
  const settings = await storage.getSettings();
  if (!settings) return { sent: 0, checked: 0 };

  const leadTimeMs = settings.reminder_lead_time * 60 * 1000;
  const todayStr = now.toISOString().slice(0, 10);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

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

      const [h, m] = booking.start_time.split(":").map(Number);
      const bookingTs = Date.UTC(
        Number(booking.date.slice(0, 4)),
        Number(booking.date.slice(5, 7)) - 1,
        Number(booking.date.slice(8, 10)),
        h,
        m,
        0,
      );
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
