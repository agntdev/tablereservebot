import { buildBot } from "./bot.js";

/**
 * Tokenless harness entry WITH NO PERSISTENT STORAGE injected.
 * The Tests-gate invokes this entry for specs that validate graceful
 * degradation when REDIS_URL is not configured.
 */
export function makeBot() {
  const token = process.env.BOT_TOKEN ?? "harness-test-token";
  if (!process.env.ADMIN_IDS) {
    process.env.ADMIN_IDS = "777";
  }
  const { bot } = buildBot(token, null);
  return bot;
}