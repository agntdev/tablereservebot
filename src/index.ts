import { buildBot } from "./bot.js";
import { checkAndSendReminders } from "./reminder.js";

// Runtime entry (dist/index.js). BOT_TOKEN is injected at runtime as a secret.
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

const REMINDER_INTERVAL_MS = (() => {
  const raw = process.env.REMINDER_INTERVAL_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 5_000) return n;
  }
  return 60_000;
})();

const { bot, storage } = buildBot(token);
void bot.start();

let reminderTimer: ReturnType<typeof setInterval> | null = null;

if (storage) {
  reminderTimer = setInterval(async () => {
    try {
      await checkAndSendReminders(storage, bot.api);
    } catch (err) {
      console.error("[reminder-worker]", err);
    }
  }, REMINDER_INTERVAL_MS);
  console.log(`[reminder-worker] started (interval ${REMINDER_INTERVAL_MS}ms)`);
}

async function shutdown(signal: string) {
  console.log(`[shutdown] received ${signal}, stopping...`);
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
  await bot.stop();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
