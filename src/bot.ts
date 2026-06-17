import { createBot } from "./toolkit/index.js";

// The per-chat session shape (ephemeral conversation state only). Extend as the
// bot grows. Durable domain data must NOT live here — use the toolkit's
// persistent storage (see AGENTS.md).
export interface Session {
  // example: step?: "awaiting_amount";
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
    await ctx.reply("Welcome! I am ready to help.");
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
