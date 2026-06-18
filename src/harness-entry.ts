import { buildBot } from "./bot.js";
import { createMemoryStorageRedis } from "./storage/memory.js";
import { createStorage } from "./storage/index.js";

export function makeBot() {
  const token = process.env.BOT_TOKEN ?? "harness-test-token";
  if (!process.env.ADMIN_IDS) {
    process.env.ADMIN_IDS = "777";
  }
  const redis = createMemoryStorageRedis();
  const now = new Date().toISOString();
  void redis.hset(
    "settings:global",
    "open_time", "09:00",
    "close_time", "22:00",
    "timezone", "UTC",
    "sitting_length", "90",
    "slot_increment", "15",
    "reminder_lead_time", "120",
    "created_at", now,
    "updated_at", now,
  );
  void redis.hset(
    "table:T1",
    "id", "T1",
    "seat_count", "4",
    "quantity", "5",
    "label", "4-seat table",
    "created_at", now,
  );
  void redis.sadd("tables:all", "T1");
  void redis.hset(
    "table:T2",
    "id", "T2",
    "seat_count", "2",
    "quantity", "3",
    "label", "2-seat table",
    "created_at", now,
  );
  void redis.sadd("tables:all", "T2");
  const bid = "bk-test-OWNER";
  void redis.hset(
    `booking:${bid}`,
    "id", bid,
    "ref_code", "REF-TESTOWN",
    "guest_telegram_id", "1",
    "guest_name", "Owner",
    "guest_phone", "",
    "date", "2026-06-20",
    "start_time", "14:00",
    "end_time", "15:30",
    "duration", "90",
    "party_size", "2",
    "allocated_tables", "[]",
    "status", "confirmed",
    "created_at", now,
    "updated_at", now,
  );
  void redis.sadd("bookings:all", bid);
  void redis.sadd("bookings:by-date:2026-06-20", bid);
  void redis.set("bookings:by-ref:REF-TESTOWN", bid);
  void redis.sadd("bookings:by-guest:1", bid);
  const storage = createStorage(redis);
  const { bot } = buildBot(token, storage);
  return bot;
}
