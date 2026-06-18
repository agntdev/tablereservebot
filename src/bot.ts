import {
  createBot,
  type BotContext,
  InlineKeyboardMarkup,
  inlineButton,
  inlineKeyboard,
} from "./toolkit/index.js";
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
import type { Booking } from "./storage/types.js";
import { generateSlots, type Slot } from "./slots.js";

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
    [inlineButton("📋 About", "menu:about")],
    [inlineButton("🛟 Help", "menu:help")],
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
      "Welcome! I'm your reservation assistant.\n\nHow to make a reservation:\n1. Browse availability\n2. Select a date and time\n3. Confirm your details\n\nUse the menu below to get started:",
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

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Available commands:\n/start — Start the bot\n/help — Show this help message\n/calendar — Pick a reservation date\n/slots — Browse available time slots\n/book — Make a reservation\n/reschedule — Reschedule an existing booking",
    );
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
    );
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

    if (booking.status !== "confirmed") {
      await ctx.reply(
        `Booking ${refCode} cannot be rescheduled — it is **${booking.status}**. Only confirmed bookings can be rescheduled.`,
      );
      return;
    }

    await storage.updateBooking(booking.id, {
      status: "rescheduled",
      allocated_tables: [],
    });

    ctx.session.rescheduleBookingId = booking.id;
    ctx.session.rescheduleRefCode = refCode;
    ctx.session.selectedDate = booking.date;
    ctx.session.partySize = booking.party_size;

    await ctx.reply(
      `✅ Booking ${refCode} has been released.\n\nShowing available time slots for **${booking.date}** (${booking.party_size} guest${booking.party_size > 1 ? "s" : ""}):`,
    );

    await showAvailableSlots(ctx, booking.date, booking.party_size);
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

  return bot;
}
