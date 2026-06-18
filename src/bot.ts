import { createBot, InlineKeyboardMarkup, inlineButton, inlineKeyboard } from "./toolkit/index.js";
import { Storage, defaultRedisStorageFactory } from "./storage/index.js";
import type { Booking } from "./storage/types.js";
import { generateSlots } from "./slots.js";
import { buildCalendarWeek, todayStr } from "./calendar.js";

export interface Session {
  selectedDate?: string;
  bookingStep?: string;
}

function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dow = dayNames[d.getUTCDay()];
  return `${dow}, ${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}-${year}`;
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
export function buildBot(token: string) {
  const bot = createBot<Session>(token, {
    initial: () => ({}),
  });

  let storage: Storage | null = null;
  if (process.env.REDIS_URL) {
    try {
      storage = defaultRedisStorageFactory(process.env.REDIS_URL);
    } catch {
      storage = null;
    }
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
      "Available commands:\n/start — Start the bot\n/help — Show this help message\n/slots — Browse available time slots\n/book — Make a reservation\n/bookdate — Pick a date with the calendar",
    );
  });

  bot.command("bookdate", async (ctx) => {
    const start = todayStr();
    const week = buildCalendarWeek(start);
    ctx.session.selectedDate = undefined;
    ctx.session.bookingStep = "awaiting_date";
    await ctx.reply("Pick a date for your reservation:", {
      reply_markup: week.keyboard,
    });
  });

  bot.callbackQuery(/^cal:prev:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const startDate = ctx.match[1];
    if (startDate < todayStr()) {
      await ctx.reply("Cannot go before today.", {
        reply_markup: buildCalendarWeek(todayStr()).keyboard,
      });
      return;
    }
    const week = buildCalendarWeek(startDate);
    await ctx.editMessageText("Pick a date for your reservation:", {
      reply_markup: week.keyboard,
    });
  });

  bot.callbackQuery(/^cal:next:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const startDate = ctx.match[1];
    const week = buildCalendarWeek(startDate);
    await ctx.editMessageText("Pick a date for your reservation:", {
      reply_markup: week.keyboard,
    });
  });

  bot.callbackQuery(/^cal:pick:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const date = ctx.match[1];
    ctx.session.selectedDate = date;
    ctx.session.bookingStep = "awaiting_time";
    const displayDate = formatDateDisplay(date);
    await ctx.editMessageText(
      `Selected date: ${displayDate}\n\nUse /slots to browse available times on this date, then /book to complete your reservation.`,
    );
  });

  bot.command("book", async (ctx) => {
    const args = ctx.msg.text.split(/\s+/).slice(1);
    if (args.length < 1) {
      await ctx.reply(
        "Usage: /book <date> <time> <party_size> [guest_name]\n\n" +
          "Example: /book 2025-06-15 19:00 4 John\n\n" +
          "Tip: Use /bookdate to pick a date from the calendar first.",
      );
      return;
    }

    let date: string;
    let time: string;
    let partySizeStr: string;
    let nameParts: string[];

    if (/^\d{4}-\d{2}-\d{2}$/.test(args[0])) {
      date = args[0];
      if (args.length < 3) {
        await ctx.reply(
          "Usage: /book <date> <time> <party_size> [guest_name]\n\n" +
            "Example: /book 2025-06-15 19:00 4 John",
        );
        return;
      }
      time = args[1];
      partySizeStr = args[2];
      nameParts = args.slice(3);
    } else if (ctx.session.selectedDate) {
      date = ctx.session.selectedDate;
      if (args.length < 2) {
        await ctx.reply(
          `Using selected date ${formatDateDisplay(date)}.\n\n` +
            "Usage: /book <time> <party_size> [guest_name]\n" +
            "Example: /book 19:00 4 John",
        );
        return;
      }
      time = args[0];
      partySizeStr = args[1];
      nameParts = args.slice(2);
    } else {
      await ctx.reply(
        "Usage: /book <date> <time> <party_size> [guest_name]\n\n" +
          "Example: /book 2025-06-15 19:00 4 John\n\n" +
          "Tip: Use /bookdate to pick a date from the calendar first.",
      );
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await ctx.reply("Invalid date format. Use YYYY-MM-DD (e.g. 2025-06-15).");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      await ctx.reply("Invalid time format. Use HH:MM (e.g. 19:00).");
      return;
    }
    const partySize = Number(partySizeStr);
    if (!Number.isFinite(partySize) || partySize < 1) {
      await ctx.reply("Party size must be a positive number (e.g. 4).");
      return;
    }

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

    const guestName = nameParts.length > 0 ? nameParts.join(" ") : null;
    const bookingId = `bk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const refCode = `REF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    const booking: Booking = {
      id: bookingId,
      ref_code: refCode,
      guest_telegram_id: ctx.from?.id ?? 0,
      guest_name: guestName ?? ctx.from?.first_name ?? null,
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

  bot.on("message:text").filter(
    (ctx) => !!ctx.msg.entities?.some((e) => e.type === "bot_command"),
    async (ctx) => {
      await ctx.reply(
        "I don't know that command. Send /help to see what I can do.",
      );
    },
  );

  bot.on("message:text", async (ctx) => {
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
