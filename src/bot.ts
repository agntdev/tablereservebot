import {
  createBot,
  type BotContext,
  InlineKeyboardMarkup,
  type InlineButton,
  inlineButton,
  inlineKeyboard,
  confirmKeyboard,
} from "./toolkit/index.js";
import { isAdmin } from "./admin.js";
import { findNearbyAvailableDates, listBookableSlots } from "./availability.js";
import { buildCalendar } from "./calendar.js";
import {
  buildPartySizeKeyboard,
  formatPartySizeConfirmation,
  formatPartySizePrompt,
  parsePartySizeInput,
} from "./party.js";
import { buildSlotKeyboard, formatSlotsPrompt } from "./slot-picker.js";
import { Storage, defaultRedisStorageFactory } from "./storage/index.js";
import type { Booking, Settings } from "./storage/types.js";
import { generateSlots, type Slot } from "./slots.js";
import { checkAndSendReminders } from "./reminder.js";

const STORAGE_UNAVAILABLE =
  "Slot availability is unavailable — persistent storage is not configured. Set REDIS_URL to enable booking features.";

export interface Session {
  calYear?: number;
  calMonth?: number;
  selectedDate?: string;
  partySize?: number;
  awaitingPartySize?: boolean;
  availableSlots?: Slot[];
  slotPage?: number;
  selectedSlot?: string;
  collectingBookingGuestName?: boolean;
  collectingBookingGuestPhone?: boolean;
  bookingDate?: string;
  bookingTime?: string;
  bookingPartySize?: number;
  bookingGuestName?: string;
  bookingGuestPhone?: string | null;
  rescheduleBookingId?: string;
  rescheduleRefCode?: string;
}

function mainMenu(): InlineKeyboardMarkup {
  return inlineKeyboard([
    [inlineButton("📋 How to Reserve", "menu:about")],
    [inlineButton("🛟 Need Assistance?", "menu:help")],
    [inlineButton("⚙️ Settings", "menu:settings")],
  ]);
}

/**
 * buildBot — assembles the bot and registers every handler, but does NOT start
 * it. Shared by the runtime entry (src/index.ts) and the Tests-gate harness
 * (src/harness-entry.ts) so both exercise the exact same bot. Add new commands
 * and flows here.
 */
export function buildBot(token: string, injectedStorage?: Storage | null) {
  const bot = createBot<Session>(token, {
    initial: () => ({}),
  });

  let storage: Storage | null = null;
  if (injectedStorage !== undefined) {
    storage = injectedStorage;
  } else if (process.env.REDIS_URL) {
    try {
      storage = defaultRedisStorageFactory(process.env.REDIS_URL);
    } catch {
      storage = null;
    }
  }

  async function showAvailableSlots(
    ctx: BotContext<Session>,
    dateStr: string,
    partySize: number,
  ): Promise<void> {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (dateStr < todayStr) {
      await ctx.reply("Date cannot be in the past. Please pick today or a future date with /calendar.");
      return;
    }

    if (!storage) {
      await ctx.reply(STORAGE_UNAVAILABLE);
      return;
    }

    const { slots, error } = await listBookableSlots(storage, dateStr, partySize);
    if (error) {
      const nearby = await findNearbyAvailableDates(storage, dateStr, partySize);
      if (nearby.length > 0) {
        const dateList = nearby.join(", ");
        await ctx.reply(
          `${error}\n\nNearest available dates: ${dateList}. Use /calendar to pick another date.`,
        );
      } else {
        await ctx.reply(error);
      }
      return;
    }

    ctx.session.availableSlots = slots;
    ctx.session.slotPage = 0;
    await ctx.reply(formatSlotsPrompt(dateStr, partySize, slots.length), {
      reply_markup: buildSlotKeyboard(slots, 0),
    });
  }

  async function finalizeBooking(ctx: BotContext<Session>): Promise<void> {
    const { bookingDate, bookingTime, bookingPartySize, bookingGuestName, bookingGuestPhone } = ctx.session;
    if (!bookingDate || !bookingTime || !bookingPartySize || !bookingGuestName) {
      await ctx.reply("Booking session expired. Please start again with /book.");
      return;
    }

    if (!storage) {
      await ctx.reply(STORAGE_UNAVAILABLE);
      return;
    }

    const settings = await storage.getSettings();
    if (!settings) {
      await ctx.reply(
        "Opening hours are not configured yet. A venue admin must set them up first.",
      );
      return;
    }

    const timeMins = (() => {
      const [h, m] = bookingTime.split(":").map(Number);
      return h * 60 + m;
    })();
    const endTimeMins = timeMins + settings.sitting_length;
    const endHours = Math.floor(endTimeMins / 60) % 24;
    const endMinutes = endTimeMins % 60;
    const endTime =
      String(endHours).padStart(2, "0") +
      ":" +
      String(endMinutes).padStart(2, "0");

    const bookingId = `bk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const refCode = `REF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    const booking: Booking = {
      id: bookingId,
      ref_code: refCode,
      guest_telegram_id: ctx.from?.id ?? 0,
      guest_name: bookingGuestName,
      guest_phone: bookingGuestPhone ?? null,
      date: bookingDate,
      start_time: bookingTime,
      end_time: endTime,
      duration: settings.sitting_length,
      party_size: bookingPartySize,
      allocated_tables: [],
      status: "confirmed",
      created_at: now,
      updated_at: now,
    };

    const result = await storage.createBookingAtomic(
      booking,
      bookingDate,
      bookingTime,
      endTime,
      bookingPartySize,
    );
    if (!result.success) {
      await ctx.reply(
        `Cannot book: ${result.reason}\n` +
          `Needed seats: ${result.needed_seats}\n` +
          `Available seats: ${result.available_seats}`,
      );
      ctx.session.bookingDate = undefined;
      ctx.session.bookingTime = undefined;
      ctx.session.bookingPartySize = undefined;
      ctx.session.bookingGuestName = undefined;
      ctx.session.bookingGuestPhone = undefined;
      ctx.session.collectingBookingGuestName = undefined;
      ctx.session.collectingBookingGuestPhone = undefined;
      return;
    }

    const tableTypes = await storage.listTableTypes();
    const lines = result.tables.map((a) => {
      const tt = tableTypes.find((t) => t.id === a.table_type_id);
      const label = tt ? tt.label : a.table_type_id;
      return `${a.count}× ${label}`;
    });

    await ctx.reply(
      `✅ Booking confirmed!\n\n` +
        `Ref: ${refCode}\n` +
        `Name: ${bookingGuestName}\n` +
        (bookingGuestPhone ? `Phone: ${bookingGuestPhone}\n` : "") +
        `Date: ${bookingDate}\n` +
        `Time: ${bookingTime}–${endTime}\n` +
        `Party: ${bookingPartySize}\n` +
        `Tables: ${lines.join(", ")}`,
      { reply_markup: mainMenu() },
    );

    ctx.session.bookingDate = undefined;
    ctx.session.bookingTime = undefined;
    ctx.session.bookingPartySize = undefined;
    ctx.session.bookingGuestName = undefined;
    ctx.session.bookingGuestPhone = undefined;
    ctx.session.collectingBookingGuestName = undefined;
    ctx.session.collectingBookingGuestPhone = undefined;
  }

  async function finalizeReschedule(
    ctx: BotContext<Session>,
    newStartTime: string,
  ): Promise<void> {
    const { rescheduleBookingId, selectedDate, rescheduleRefCode } =
      ctx.session;
    if (!rescheduleBookingId || !selectedDate || !storage) {
      await ctx.reply(
        "Reschedule session expired. Please try again with /reschedule <ref_code>.",
      );
      return;
    }

    const original = await storage.getBooking(rescheduleBookingId);
    if (!original) {
      await ctx.reply("Original booking not found.");
      ctx.session.rescheduleBookingId = undefined;
      ctx.session.rescheduleRefCode = undefined;
      return;
    }

    const settings = await storage.getSettings();
    if (!settings) {
      await ctx.reply(
        "Opening hours are not configured yet. A venue admin must set them up first.",
      );
      return;
    }

    const timeMins = (() => {
      const [h, m] = newStartTime.split(":").map(Number);
      return h * 60 + m;
    })();
    const endTimeMins = timeMins + settings.sitting_length;
    const endHours = Math.floor(endTimeMins / 60) % 24;
    const endMinutes = endTimeMins % 60;
    const endTime =
      String(endHours).padStart(2, "0") +
      ":" +
      String(endMinutes).padStart(2, "0");

    const bookingId = `bk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const refCode = `REF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    const savedAllocatedTables = original.allocated_tables;
    const savedStatus = original.status;
    await storage.updateBooking(original.id, { status: "rescheduled", allocated_tables: [] });

    const booking: Booking = {
      id: bookingId,
      ref_code: refCode,
      guest_telegram_id: ctx.from?.id ?? 0,
      guest_name: original.guest_name,
      guest_phone: original.guest_phone,
      date: selectedDate,
      start_time: newStartTime,
      end_time: endTime,
      duration: settings.sitting_length,
      party_size: original.party_size,
      allocated_tables: [],
      status: "confirmed",
      created_at: now,
      updated_at: now,
    };

    const result = await storage.createBookingAtomic(
      booking,
      selectedDate,
      newStartTime,
      endTime,
      original.party_size,
    );
    if (!result.success) {
      await storage.updateBooking(original.id, { status: savedStatus, allocated_tables: savedAllocatedTables });
      await ctx.reply(
        `Cannot reschedule: ${result.reason}\n` +
          `Needed seats: ${result.needed_seats}\n` +
          `Available seats: ${result.available_seats}`,
      );
      ctx.session.rescheduleBookingId = undefined;
      ctx.session.rescheduleRefCode = undefined;
      ctx.session.selectedDate = undefined;
      ctx.session.partySize = undefined;
      ctx.session.availableSlots = undefined;
      return;
    }

    const tableTypes = await storage.listTableTypes();
    const lines = result.tables.map((a) => {
      const tt = tableTypes.find((t) => t.id === a.table_type_id);
      const label = tt ? tt.label : a.table_type_id;
      return `${a.count}× ${label}`;
    });

    await ctx.editMessageText(
      `✅ Rescheduled!\n\n` +
        `Ref: ${refCode}\n` +
        `Name: ${original.guest_name}\n` +
        (original.guest_phone ? `Phone: ${original.guest_phone}\n` : "") +
        `Date: ${selectedDate}\n` +
        `Time: ${newStartTime}–${endTime}\n` +
        `Party: ${original.party_size}\n` +
        `Tables: ${lines.join(", ")}\n\n` +
        `Original booking ${rescheduleRefCode ?? rescheduleBookingId} has been released.`,
      { reply_markup: mainMenu() },
    );

    ctx.session.rescheduleBookingId = undefined;
    ctx.session.rescheduleRefCode = undefined;
    ctx.session.selectedDate = undefined;
    ctx.session.partySize = undefined;
    ctx.session.availableSlots = undefined;
  }

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Welcome! I'm your reservation assistant.\n\nHow to make a reservation:\n1. Browse availability\n2. Select a date and time\n3. Confirm your details\n\nUse the buttons below to reserve, get help, or configure restaurant settings (for owners only).\n\nUse the menu below to get started:",
      { reply_markup: mainMenu() },
    );
  });

  bot.callbackQuery("menu:about", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "I am the AGNTDEV bot, built with the grammY framework and the AGNTDEV bot toolkit. I help you build, test, and deploy Telegram bots.",
      { reply_markup: mainMenu() },
    );
  });

  bot.callbackQuery("menu:help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "Available commands:\n" +
        "/start — Show the main menu\n\n" +
        "Use the menu buttons below to navigate.",
      { reply_markup: mainMenu() },
    );
  });

  bot.callbackQuery("menu:settings", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "Settings are managed through the bot's environment and persistent storage. Use the menu below to navigate.",
      { reply_markup: mainMenu() },
    );
  });

  bot.callbackQuery("cancel:yes", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.selectedDate = undefined;
    ctx.session.partySize = undefined;
    ctx.session.awaitingPartySize = undefined;
    ctx.session.availableSlots = undefined;
    ctx.session.slotPage = undefined;
    ctx.session.selectedSlot = undefined;
    ctx.session.collectingBookingGuestName = undefined;
    ctx.session.collectingBookingGuestPhone = undefined;
    ctx.session.bookingDate = undefined;
    ctx.session.bookingTime = undefined;
    ctx.session.bookingPartySize = undefined;
    ctx.session.bookingGuestName = undefined;
    ctx.session.bookingGuestPhone = undefined;
    ctx.session.rescheduleBookingId = undefined;
    ctx.session.rescheduleRefCode = undefined;
    ctx.session.calYear = undefined;
    ctx.session.calMonth = undefined;
    await ctx.editMessageText("✅ Operation cancelled. Use /start to begin again.", {
      reply_markup: mainMenu(),
    });
  });

  bot.callbackQuery("cancel:no", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("⚠️ Cancellation was not applied. Continue where you left off.", {
      reply_markup: mainMenu(),
    });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Available commands:\n/start — Start the bot\n/help — Show this help message\n/booking — View booking details by reference code\n/calendar — Pick a reservation date\n/slots — Browse available time slots\n/today — Show today's bookings and remaining capacity\n/upcoming — Show upcoming bookings for the next days\n/book — Make a reservation\n/reschedule — Reschedule an existing booking\n/cancel — Cancel the current operation\n/mark_noshow — Mark a booking as no-show (admin only)",
    );
  });

  bot.command("cancel", async (ctx) => {
    await ctx.reply("Cancel the current operation? This will discard any in-progress reservation or reschedule.", {
      reply_markup: confirmKeyboard("cancel"),
    });
  });

  bot.command("calendar", async (ctx) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    ctx.session.calYear = year;
    ctx.session.calMonth = month;
    const cal = buildCalendar(year, month);
    await ctx.reply(cal.text, { reply_markup: cal.keyboard });
  });

  bot.callbackQuery(/^cal:nav:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const year = Number.parseInt(ctx.match[1], 10);
    const month = Number.parseInt(ctx.match[2], 10);
    ctx.session.calYear = year;
    ctx.session.calMonth = month;
    const cal = buildCalendar(year, month);
    await ctx.editMessageText(cal.text, { reply_markup: cal.keyboard });
  });

  bot.callbackQuery(/^cal:pick:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const dateStr = ctx.match[1];
    const todayStr = new Date().toISOString().slice(0, 10);
    if (dateStr < todayStr) {
      await ctx.editMessageText(
        `Date **${dateStr}** is in the past. Please select today or a future date.`,
      );
      return;
    }
    ctx.session.selectedDate = dateStr;
    ctx.session.partySize = undefined;
    ctx.session.awaitingPartySize = true;
    await ctx.editMessageText(`✅ You selected **${dateStr}**.`);
    await ctx.reply(formatPartySizePrompt(dateStr), {
      reply_markup: buildPartySizeKeyboard(),
    });
  });

  bot.callbackQuery(/^party:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const dateStr = ctx.session.selectedDate;
    if (!dateStr) {
      await ctx.editMessageText("Please pick a date first with /calendar.");
      return;
    }

    const partySize = Number.parseInt(ctx.match[1], 10);
    if (!Number.isFinite(partySize) || partySize < 1 || partySize > 99) {
      await ctx.answerCallbackQuery({ text: "Invalid party size." });
      return;
    }

    ctx.session.partySize = partySize;
    ctx.session.awaitingPartySize = false;
    await ctx.editMessageText(formatPartySizeConfirmation(dateStr, partySize));
    await showAvailableSlots(ctx, dateStr, partySize);
  });

  bot.callbackQuery("party:type", async (ctx) => {
    await ctx.answerCallbackQuery();
    const dateStr = ctx.session.selectedDate;
    if (!dateStr) {
      await ctx.editMessageText("Please pick a date first with /calendar.");
      return;
    }

    ctx.session.awaitingPartySize = true;
    await ctx.editMessageText("Type the number of guests (1–99):");
  });

  bot.callbackQuery(/^slot:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const dateStr = ctx.session.selectedDate;
    const partySize = ctx.session.partySize;
    const slots = ctx.session.availableSlots;
    if (!dateStr || !partySize || !slots || slots.length === 0) {
      await ctx.editMessageText("Please restart your reservation with /calendar.");
      return;
    }

    const page = Number.parseInt(ctx.match[1], 10);
    if (!Number.isFinite(page) || page < 0) {
      return;
    }

    ctx.session.slotPage = page;
    await ctx.editMessageText(formatSlotsPrompt(dateStr, partySize, slots.length), {
      reply_markup: buildSlotKeyboard(slots, page),
    });
  });

  bot.callbackQuery(/^slot:pick:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const startTime = ctx.match[1];
    const dateStr = ctx.session.selectedDate;
    const partySize = ctx.session.partySize;
    if (!dateStr || !partySize) {
      await ctx.editMessageText("Please restart your reservation with /calendar.");
      return;
    }

    if (ctx.session.rescheduleBookingId) {
      await finalizeReschedule(ctx, startTime);
      return;
    }

    ctx.session.selectedSlot = startTime;
    await ctx.editMessageText(
      `✅ Date: ${dateStr}\nGuests: ${partySize}\nTime: ${startTime}`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("📋 Book this slot", "slot:book")],
        ]),
      },
    );
  });

  bot.callbackQuery("slot:book", async (ctx) => {
    await ctx.answerCallbackQuery();
    const dateStr = ctx.session.selectedDate;
    const partySize = ctx.session.partySize;
    const startTime = ctx.session.selectedSlot;
    if (!dateStr || !partySize || !startTime) {
      await ctx.editMessageText("Please restart your reservation with /calendar.");
      return;
    }

    ctx.session.bookingDate = dateStr;
    ctx.session.bookingTime = startTime;
    ctx.session.bookingPartySize = partySize;
    ctx.session.collectingBookingGuestName = true;

    ctx.session.selectedDate = undefined;
    ctx.session.partySize = undefined;
    ctx.session.availableSlots = undefined;
    ctx.session.selectedSlot = undefined;
    ctx.session.slotPage = undefined;
    ctx.session.awaitingPartySize = undefined;

    await ctx.editMessageText("Please enter the guest name for the reservation:");
  });

  bot.callbackQuery("cal:ignore", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.command("book", async (ctx) => {
    const args = ctx.msg.text.split(/\s+/).slice(1);
    if (args.length < 3) {
      await ctx.reply(
        "Usage: /book <date> <time> <party_size> [guest_name]\n\n" +
          "Example: /book 2025-06-15 19:00 4 John",
      );
      return;
    }
    const [date, time, partySizeStr, ...nameParts] = args;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await ctx.reply("Invalid date format. Use YYYY-MM-DD (e.g. 2025-06-15).");
      return;
    }
    const dateParts = date.split("-");
    const year = Number.parseInt(dateParts[0], 10);
    const month = Number.parseInt(dateParts[1], 10);
    const day = Number.parseInt(dateParts[2], 10);
    if (year < 2000 || month < 1 || month > 12 || day < 1) {
      await ctx.reply("Invalid date. Use a real date in YYYY-MM-DD format (e.g. 2025-06-15).");
      return;
    }
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day > daysInMonth) {
      await ctx.reply("Invalid date. Use a real date in YYYY-MM-DD format (e.g. 2025-06-15).");
      return;
    }
    const nowDate = new Date().toISOString().slice(0, 10);
    if (date < nowDate) {
      await ctx.reply("Date cannot be in the past. Please choose today or a future date.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      await ctx.reply("Invalid time format. Use HH:MM (e.g. 19:00).");
      return;
    }
    const timeParts = time.split(":");
    const hours = Number.parseInt(timeParts[0], 10);
    const minutes = Number.parseInt(timeParts[1], 10);
    if (!Number.isFinite(hours) || hours < 0 || hours > 23 ||
        !Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
      await ctx.reply("Invalid time. Hours must be 00–23 and minutes must be 00–59 (e.g. 19:00).");
      return;
    }
    const partySize = Number(partySizeStr);
    if (!Number.isFinite(partySize) || partySize < 1) {
      await ctx.reply("Party size must be a positive number (e.g. 4).");
      return;
    }

    if (nameParts.length === 0) {
      ctx.session.awaitingPartySize = undefined;
      ctx.session.collectingBookingGuestPhone = undefined;
      ctx.session.selectedDate = undefined;
      ctx.session.partySize = undefined;
      ctx.session.availableSlots = undefined;
      ctx.session.slotPage = undefined;
      ctx.session.selectedSlot = undefined;
      ctx.session.bookingDate = date;
      ctx.session.bookingTime = time;
      ctx.session.bookingPartySize = partySize;
      ctx.session.collectingBookingGuestName = true;
      await ctx.reply("Please enter the guest name for the reservation:");
      return;
    }

    const guestName = nameParts.join(" ");

    if (!storage) {
      await ctx.reply(
        "Booking is unavailable — persistent storage is not configured. Set REDIS_URL to enable booking features.",
      );
      return;
    }
    const settings = await storage.getSettings();
    if (!settings) {
      await ctx.reply(
        "Opening hours are not configured yet. A venue admin must set them up first.",
      );
      return;
    }
    const timeMins = (() => {
      const [h, m] = time.split(":").map(Number);
      return h * 60 + m;
    })();
    const endTimeMins = timeMins + settings.sitting_length;
    const endHours = Math.floor(endTimeMins / 60) % 24;
    const endMinutes = endTimeMins % 60;
    const endTime =
      String(endHours).padStart(2, "0") +
      ":" +
      String(endMinutes).padStart(2, "0");

    const bookingId = `bk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const refCode = `REF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    const booking: Booking = {
      id: bookingId,
      ref_code: refCode,
      guest_telegram_id: ctx.from?.id ?? 0,
      guest_name: guestName,
      guest_phone: null,
      date,
      start_time: time,
      end_time: endTime,
      duration: settings.sitting_length,
      party_size: partySize,
      allocated_tables: [],
      status: "confirmed",
      created_at: now,
      updated_at: now,
    };

    const result = await storage.createBookingAtomic(booking, date, time, endTime, partySize);
    if (!result.success) {
      await ctx.reply(
        `Cannot book: ${result.reason}\n` +
          `Needed seats: ${result.needed_seats}\n` +
          `Available seats: ${result.available_seats}`,
      );
      return;
    }

    const tableTypes = await storage.listTableTypes();
    const lines = result.tables.map((a) => {
      const tt = tableTypes.find((t) => t.id === a.table_type_id);
      const label = tt ? tt.label : a.table_type_id;
      return `${a.count}× ${label}`;
    });

    await ctx.reply(
      `✅ Booking confirmed!\n\n` +
        `Ref: ${refCode}\n` +
        `Name: ${guestName}\n` +
        `Date: ${date}\n` +
        `Time: ${time}–${endTime}\n` +
        `Party: ${partySize}\n` +
        `Tables: ${lines.join(", ")}`,
      { reply_markup: mainMenu() },
    );
  });

  bot.command("slots", async (ctx) => {
    if (!storage) {
      await ctx.reply(
        "Slot generation is unavailable — persistent storage is not configured. Set REDIS_URL to enable booking features.",
      );
      return;
    }
    const settings = await storage.getSettings();
    if (!settings) {
      await ctx.reply(
        "Opening hours are not configured yet. A venue admin must set them up first.",
      );
      return;
    }
    const slots = generateSlots(settings);
    if (slots.length === 0) {
      await ctx.reply(
        "No available slots within the configured opening hours. Check the venue settings.",
      );
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const lines = slots.map((s) => `${s.start}–${s.end}`);
    await ctx.reply(
      `Available slots for ${today}:\n\n${lines.join("\n")}`,
    );
  });

  bot.command("today", async (ctx) => {
    if (!storage) {
      await ctx.reply(STORAGE_UNAVAILABLE);
      return;
    }

    const settings = await storage.getSettings();
    if (!settings) {
      await ctx.reply(
        "Opening hours are not configured yet. A venue admin must set them up first.",
      );
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const bookings = await storage.listBookingsByDate(today);
    const confirmed = bookings.filter((b) => b.status === "confirmed");

    const tableTypes = await storage.listTableTypes();
    const totalCapacity = tableTypes.reduce(
      (sum, tt) => sum + tt.seat_count * tt.quantity,
      0,
    );
    const totalBooked = confirmed.reduce((sum, b) => sum + b.party_size, 0);
    const remaining = Math.max(0, totalCapacity - totalBooked);

    let msg = `📅 Today: ${today}\n\n`;
    msg += `Capacity: ${totalCapacity} seats total\n`;
    msg += `Booked: ${totalBooked} guests\n`;
    msg += `Remaining: ${remaining} seats\n\n`;

    if (confirmed.length === 0) {
      msg += "No bookings for today yet.\n\nUse /book to make a reservation!";
    } else {
      msg += `Today's bookings (${confirmed.length}):\n\n`;
      for (const b of confirmed.sort((a, b) =>
        a.start_time.localeCompare(b.start_time),
      )) {
        const name = b.guest_name ?? "Guest";
        msg += `• ${b.start_time}–${b.end_time}: ${name} (${b.party_size} pax) — ${b.ref_code}\n`;
      }
    }

    await ctx.reply(msg, { reply_markup: mainMenu() });
  });

  bot.command("upcoming", async (ctx) => {
    const args = ctx.msg.text.split(/\s+/).slice(1);
    let days = 7;
    if (args.length > 0) {
      days = Number(args[0]);
    }

    if (!Number.isFinite(days) || days < 1 || days > 365) {
      await ctx.reply("Days must be a positive number (1–365). Example: /upcoming 7");
      return;
    }

    if (!storage) {
      await ctx.reply(STORAGE_UNAVAILABLE);
      return;
    }

    const bookings: Booking[] = [];
    const today = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayBookings = await storage.listBookingsByDate(dateStr);
      bookings.push(...dayBookings);
    }

    const confirmed = bookings
      .filter((b) => b.status === "confirmed")
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.start_time.localeCompare(b.start_time);
      });

    let msg = `Upcoming bookings (next ${days} day${days > 1 ? "s" : ""}):\n\n`;

    if (confirmed.length === 0) {
      msg += "No upcoming bookings. Use /book to make a reservation!";
    } else {
      for (const b of confirmed) {
        const name = b.guest_name ?? "Guest";
        msg += `• ${b.date} ${b.start_time}–${b.end_time}: ${name} (${b.party_size} pax) — ${b.ref_code}\n`;
      }
    }

    await ctx.reply(msg, { reply_markup: mainMenu() });
  });

  bot.command("reschedule", async (ctx) => {
    const args = ctx.msg.text.split(/\s+/).slice(1);
    if (args.length < 1) {
      await ctx.reply(
        "Usage: /reschedule <ref_code>\n\n" +
          "Example: /reschedule REF-ABC123\n\n" +
          "Provide your booking reference to release your current time slot and pick a new one.",
      );
      return;
    }
    const refCode = args[0].trim().toUpperCase();

    if (!storage) {
      await ctx.reply(STORAGE_UNAVAILABLE);
      return;
    }

    const booking = await storage.getBookingByRef(refCode);
    if (!booking) {
      await ctx.reply(
        `Booking with reference **${refCode}** was not found. Please check your reference and try again.`,
      );
      return;
    }

    if (booking.guest_telegram_id !== 0 && booking.guest_telegram_id !== ctx.from?.id) {
      await ctx.reply(
        `Booking **${refCode}** does not belong to you. Only the guest who made the booking can reschedule it.`,
      );
      return;
    }

    if (booking.status !== "confirmed") {
      await ctx.reply(
        `Booking ${refCode} cannot be rescheduled — it is **${booking.status}**. Only confirmed bookings can be rescheduled.`,
      );
      return;
    }

    ctx.session.rescheduleBookingId = booking.id;
    ctx.session.rescheduleRefCode = refCode;
    ctx.session.selectedDate = booking.date;
    ctx.session.partySize = booking.party_size;

    await ctx.reply(
      `✅ Booking ${refCode} has been released.\n\nShowing available time slots for **${booking.date}** (${booking.party_size} guest${booking.party_size > 1 ? "s" : ""}):`,
    );

    await showAvailableSlots(ctx, booking.date, booking.party_size);
  });

  bot.command("booking", async (ctx) => {
    const args = ctx.msg.text.split(/\s+/).slice(1);
    if (args.length < 1) {
      await ctx.reply(
        "Usage: /booking <ref_code>\n\nExample: /booking REF-ABC123",
      );
      return;
    }
    const refCode = args[0].trim().toUpperCase();

    if (!storage) {
      await ctx.reply(STORAGE_UNAVAILABLE);
      return;
    }

    const booking = await storage.getBookingByRef(refCode);
    if (!booking) {
      await ctx.reply(
        `Booking with reference **${refCode}** was not found. Please check the reference and try again.`,
      );
      return;
    }

    const admin = isAdmin(ctx);
    const tableTypes = await storage.listTableTypes();

    let msg = `📋 Booking Details\n\n`;
    msg += `Ref: ${booking.ref_code}\n`;
    msg += `Guest: ${booking.guest_name ?? "N/A"}\n`;
    if (booking.guest_phone) msg += `Phone: ${booking.guest_phone}\n`;
    msg += `Date: ${booking.date}\n`;
    msg += `Time: ${booking.start_time}–${booking.end_time}\n`;
    msg += `Party: ${booking.party_size}\n`;
    msg += `Status: ${booking.status}\n`;

    if (booking.allocated_tables.length > 0) {
      const lines = booking.allocated_tables.map((a) => {
        const tt = tableTypes.find((t) => t.id === a.table_type_id);
        const label = tt ? tt.label : a.table_type_id;
        return `${a.count}× ${label}`;
      });
      msg += `Tables: ${lines.join(", ")}\n`;
    }

    if (admin && booking.status === "confirmed") {
      const noshowCount = await storage.getNoShowCount(booking.guest_telegram_id);
      if (noshowCount > 0) {
        msg += `No-show history: ${noshowCount} time(s)\n`;
      }
      const buttons: InlineButton[][] = [
        [inlineButton("❌ Cancel Booking", `booking:cancel:${refCode}`)],
        [inlineButton("🚫 Mark No-Show", `booking:noshow:${refCode}`)],
      ];
      await ctx.reply(msg, { reply_markup: inlineKeyboard(buttons) });
    } else {
      await ctx.reply(msg, { reply_markup: mainMenu() });
    }
  });

  const admin = bot.filter((ctx) => isAdmin(ctx));

  admin.command("admin", async (ctx) => {
    await ctx.reply(
      "Admin panel\n\nUse the menu below to navigate:",
      { reply_markup: mainMenu() },
    );
  });

  bot.command("admin", async (ctx) => {
    await ctx.reply("Access denied. You are not an admin.");
  });

  admin.command("mark_noshow", async (ctx) => {
    const args = ctx.msg.text.split(/\s+/).slice(1);
    if (args.length < 1) {
      await ctx.reply(
        "Usage: /mark_noshow <ref_code>\n\nExample: /mark_noshow REF-ABC123\n\nMark a confirmed booking as a no-show.",
      );
      return;
    }
    const refCode = args[0].trim().toUpperCase();

    if (!storage) {
      await ctx.reply(STORAGE_UNAVAILABLE);
      return;
    }

    const booking = await storage.getBookingByRef(refCode);
    if (!booking) {
      await ctx.reply(
        `Booking with reference **${refCode}** was not found. Please check the reference and try again.`,
      );
      return;
    }

    if (booking.status !== "confirmed") {
      await ctx.reply(
        `Booking **${refCode}** cannot be marked as no-show — it is **${booking.status}**. Only confirmed bookings can be marked as no-show.`,
      );
      return;
    }

    await storage.updateBookingStatus(booking.id, "no_show");
    await storage.incrementNoShowCount(booking.guest_telegram_id);
    const noshowCount = await storage.getNoShowCount(booking.guest_telegram_id);
    await ctx.reply(
      `✅ Booking **${refCode}** has been marked as a no-show.\n\n` +
        `Guest: ${booking.guest_name ?? "N/A"}\n` +
        `Date: ${booking.date}\n` +
        `Time: ${booking.start_time}–${booking.end_time}\n` +
        `Party: ${booking.party_size}\n` +
        `No-show count: ${noshowCount}`,
      { reply_markup: mainMenu() },
    );
  });

  admin.command("settings", async (ctx) => {
    const args = ctx.msg.text.split(/\s+/).slice(1);

    if (!storage) {
      await ctx.reply(STORAGE_UNAVAILABLE);
      return;
    }

    if (args.length === 0) {
      const settings = await storage.getSettings();
      if (!settings) {
        await ctx.reply(
          "No settings configured yet.\n\n" +
            "Use /settings set <key> <value> to configure settings.\n" +
            "Keys: open_time, close_time, timezone, sitting_length, slot_increment, reminder_lead_time\n\n" +
            "Example: /settings set open_time 09:00",
          { reply_markup: mainMenu() },
        );
        return;
      }

      const msg =
        `Current Settings:\n\n` +
        `Open Time: ${settings.open_time}\n` +
        `Close Time: ${settings.close_time}\n` +
        `Timezone: ${settings.timezone}\n` +
        `Sitting Length: ${settings.sitting_length} min\n` +
        `Slot Increment: ${settings.slot_increment} min\n` +
        `Reminder Lead Time: ${settings.reminder_lead_time} min\n\n` +
        `To update a setting, use: /settings set <key> <value>`;

      await ctx.reply(msg, { reply_markup: mainMenu() });
      return;
    }

    if (args[0] === "set") {
      if (args.length < 3) {
        await ctx.reply(
          "Usage: /settings set <key> <value>\n\n" +
            "Keys: open_time, close_time, timezone, sitting_length, slot_increment, reminder_lead_time\n\n" +
            "Example: /settings set open_time 09:00",
        );
        return;
      }

      const key = args[1];
      const value = args.slice(2).join(" ");

      const validKeys = [
        "open_time",
        "close_time",
        "timezone",
        "sitting_length",
        "slot_increment",
        "reminder_lead_time",
      ];
      if (!validKeys.includes(key)) {
        await ctx.reply(
          `Unknown setting key: "${key}". Valid keys: ${validKeys.join(", ")}.`,
        );
        return;
      }

      if (key === "open_time" || key === "close_time") {
        if (!/^\d{2}:\d{2}$/.test(value)) {
          await ctx.reply(`${key} must be in HH:MM format (e.g. 09:00).`);
          return;
        }
        const [h, m] = value.split(":").map(Number);
        if (h < 0 || h > 23 || m < 0 || m > 59) {
          await ctx.reply(
            `${key} must have hours 00–23 and minutes 00–59.`,
          );
          return;
        }
      }

      if (["sitting_length", "slot_increment", "reminder_lead_time"].includes(key)) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
          await ctx.reply(`${key} must be a positive integer (e.g. 90).`);
          return;
        }
      }

      const current = await storage.getSettings();
      const now = new Date().toISOString();
      const updated: Settings = {
        open_time: (key === "open_time" ? value : current?.open_time) ?? "09:00",
        close_time: (key === "close_time" ? value : current?.close_time) ?? "22:00",
        timezone: (key === "timezone" ? value : current?.timezone) ?? "UTC",
        sitting_length: key === "sitting_length" ? Number(value) : (current?.sitting_length ?? 90),
        slot_increment: key === "slot_increment" ? Number(value) : (current?.slot_increment ?? 15),
        reminder_lead_time: key === "reminder_lead_time" ? Number(value) : (current?.reminder_lead_time ?? 120),
        created_at: current?.created_at ?? now,
        updated_at: now,
      };

      await storage.saveSettings(updated);
      await ctx.reply(`✅ ${key} set to ${value}.`, { reply_markup: mainMenu() });
      return;
    }

    await ctx.reply(
      "Usage: /settings — show current settings\n" +
        "/settings set <key> <value> — update a setting\n\n" +
        "Keys: open_time, close_time, timezone, sitting_length, slot_increment, reminder_lead_time\n\n" +
        "Example: /settings set open_time 08:00",
    );
  });

  admin.command("remind", async (ctx) => {
    if (!storage) {
      await ctx.reply(STORAGE_UNAVAILABLE);
      return;
    }

    const now = new Date();
    const result = await checkAndSendReminders(storage, ctx.api, now);

    if (result.checked === 0) {
      await ctx.reply(
        "No confirmed bookings found for today or tomorrow.",
        { reply_markup: mainMenu() },
      );
    } else if (result.sent === 0) {
      await ctx.reply(
        `Checked ${result.checked} upcoming booking(s) — no reminders needed at this time.`,
        { reply_markup: mainMenu() },
      );
    } else {
      await ctx.reply(
        `Sent ${result.sent} reminder(s) out of ${result.checked} upcoming booking(s).`,
        { reply_markup: mainMenu() },
      );
    }
  });

  bot.command("mark_noshow", async (ctx) => {
    await ctx.reply("Access denied. You are not an admin.");
  });

  bot.command("settings", async (ctx) => {
    await ctx.reply("Access denied. You are not an admin.");
  });

  bot.command("remind", async (ctx) => {
    await ctx.reply("Access denied. You are not an admin.");
  });

  admin.callbackQuery(/^booking:cancel:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const refCode = ctx.match[1];
    await ctx.editMessageText(
      `Are you sure you want to cancel booking **${refCode}**? This action cannot be undone.`,
      { reply_markup: confirmKeyboard(`booking:cancel_confirm:${refCode}`) },
    );
  });

  admin.callbackQuery(/^booking:cancel_confirm:(.+):(yes|no)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, refCode, action] = ctx.match;
    if (action === "no") {
      await ctx.editMessageText("Booking cancellation was not applied.", {
        reply_markup: mainMenu(),
      });
      return;
    }

    if (!storage) {
      await ctx.reply(STORAGE_UNAVAILABLE);
      return;
    }

    const booking = await storage.getBookingByRef(refCode);
    if (!booking) {
      await ctx.editMessageText("Booking not found.");
      return;
    }

    await storage.updateBookingStatus(booking.id, "cancelled");
    await ctx.editMessageText(`✅ Booking **${refCode}** has been cancelled.`, {
      reply_markup: mainMenu(),
    });
  });

  admin.callbackQuery(/^booking:noshow:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const refCode = ctx.match[1];
    await ctx.editMessageText(
      `Are you sure you want to mark booking **${refCode}** as a no-show?`,
      { reply_markup: confirmKeyboard(`booking:noshow_confirm:${refCode}`) },
    );
  });

  admin.callbackQuery(/^booking:noshow_confirm:(.+):(yes|no)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, refCode, action] = ctx.match;
    if (action === "no") {
      await ctx.editMessageText("No-show mark was not applied.", {
        reply_markup: mainMenu(),
      });
      return;
    }

    if (!storage) {
      await ctx.reply(STORAGE_UNAVAILABLE);
      return;
    }

    const booking = await storage.getBookingByRef(refCode);
    if (!booking) {
      await ctx.editMessageText("Booking not found.");
      return;
    }

    await storage.updateBookingStatus(booking.id, "no_show");
    await storage.incrementNoShowCount(booking.guest_telegram_id);
    const noshowCount = await storage.getNoShowCount(booking.guest_telegram_id);
    await ctx.editMessageText(
      `✅ Booking **${refCode}** has been marked as a no-show.\n\nThis guest has ${noshowCount} no-show(s) on record.`,
      { reply_markup: mainMenu() },
    );
  });

  bot.callbackQuery("guest:skip_phone", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.bookingGuestPhone = null;
    ctx.session.collectingBookingGuestPhone = false;
    await finalizeBooking(ctx);
  });

  bot.on("message:text").filter(
    (ctx) => !!ctx.msg.entities?.some((e) => e.type === "bot_command"),
    async (ctx) => {
      await ctx.reply(
        "I don't know that command. Send /help to see what I can do.",
      );
    },
  );

  bot.on("message:text", async (ctx) => {
    if (ctx.session.awaitingPartySize) {
      const dateStr = ctx.session.selectedDate;
      if (!dateStr) {
        ctx.session.awaitingPartySize = false;
        await ctx.reply("Please pick a date first with /calendar.");
        return;
      }

      const partySize = parsePartySizeInput(ctx.msg.text);
      if (partySize === null) {
        await ctx.reply("Please enter a whole number between 1 and 99.");
        return;
      }

      ctx.session.partySize = partySize;
      ctx.session.awaitingPartySize = false;
      await ctx.reply(formatPartySizeConfirmation(dateStr, partySize));
      await showAvailableSlots(ctx, dateStr, partySize);
      return;
    }

    if (ctx.session.collectingBookingGuestName) {
      const name = ctx.msg.text.trim();
      if (!name) {
        await ctx.reply("Please enter a valid guest name.");
        return;
      }
      ctx.session.bookingGuestName = name;
      ctx.session.collectingBookingGuestName = false;
      ctx.session.collectingBookingGuestPhone = true;
      await ctx.reply("Please enter a contact phone number, or skip:", {
        reply_markup: inlineKeyboard([
          [inlineButton("Skip", "guest:skip_phone")],
        ]),
      });
      return;
    }

    if (ctx.session.collectingBookingGuestPhone) {
      const phone = ctx.msg.text.trim();
      ctx.session.bookingGuestPhone = phone || null;
      ctx.session.collectingBookingGuestPhone = false;
      await finalizeBooking(ctx);
      return;
    }

    await ctx.reply("Use /start to get started.");
  });

  bot.catch(async (err) => {
    console.error("[bot] unhandled error:", err.error);
    try {
      await err.ctx.reply("Something went wrong. Please try again later.");
    } catch (_) {
      // best effort
    }
  });

  return { bot, storage };
}
