import { buildBot } from "./bot.js";
import { defaultRedisStorageFactory } from "./storage/index.js";

// Runtime entry (dist/index.js). BOT_TOKEN is injected at runtime as a secret.
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

const storage = process.env.REDIS_URL ? defaultRedisStorageFactory(process.env.REDIS_URL) : undefined;

const bot = buildBot(token, storage);
bot.start();
