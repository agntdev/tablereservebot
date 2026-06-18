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

  const testBookingId = "bk-test-resched";
  const testRefCode = "REF-TEST";
  const testDate = "2026-06-20";
  const testGuestId = 1;
  void redis.hset(
    `booking:${testBookingId}`,
    "id", testBookingId,
    "ref_code", testRefCode,
    "guest_telegram_id", String(testGuestId),
    "guest_name", "Test Guest",
    "guest_phone", "+15551234567",
    "date", testDate,
    "start_time", "12:00",
    "end_time", "13:30",
    "duration", "90",
    "party_size", "2",
    "allocated_tables", "[]",
    "status", "confirmed",
    "created_at", now,
    "updated_at", now,
  );
  void redis.sadd("bookings:all", testBookingId);
  void redis.sadd(`bookings:by-date:${testDate}`, testBookingId);
  void redis.set(`bookings:by-ref:${testRefCode}`, testBookingId);
  void redis.sadd(`bookings:by-guest:${testGuestId}`, testBookingId);

  const storage = createStorage(redis);
  return buildBot(token, storage);
}
