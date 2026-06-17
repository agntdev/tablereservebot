import { createBot, InlineKeyboardMarkup, inlineButton, inlineKeyboard } from "./toolkit/index.js";

// The per-chat session shape (ephemeral conversation state only). Extend as the
// bot grows. Durable domain data must NOT live here — use the toolkit's
// persistent storage (see AGENTS.md).
export interface Session {
  // example: step?: "awaiting_amount";
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
      "Available commands:\n/start — Start the bot\n/help — Show this help message",
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
