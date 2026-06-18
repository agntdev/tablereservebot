import { buildBot } from "./bot.js";
import { checkAndSendReminders } from "./reminder.js";

// Runtime entry (dist/index.js). BOT_TOKEN is injected at runtime as a secret.
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

const { bot, storage } = buildBot(token);
void bot.start();

if (storage) {
  setInterval(async () => {
    try {
      await checkAndSendReminders(storage, bot.api);
    } catch (err) {
      console.error("[reminder-worker]", err);
    }
  }, 60_000);
}
