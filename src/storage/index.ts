import { createRequire } from "node:module";
import type {
  AllocationDetail,
  Booking,
  BookingStatus,
  Owner,
  Settings,
  TableAllocation,
  TableType,
} from "./types.js";

const KEY = {
  owner: (id: number) => `owner:${id}`,
  ownersAll: "owners:all",
  settingsGlobal: "settings:global",
  table: (id: string) => `table:${id}`,
  tablesAll: "tables:all",
  booking: (id: string) => `booking:${id}`,
  bookingsAll: "bookings:all",
  bookingsByDate: (date: string) => `bookings:by-date:${date}`,
  bookingsByRef: (ref: string) => `bookings:by-ref:${ref}`,
  allocation: (bookingId: string) => `allocation:${bookingId}`,
} as const;

export interface StorageRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, ...args: string[]): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, ...members: string[]): Promise<number>;
  sismember(key: string, member: string): Promise<number>;
  scard(key: string): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export class Storage {
  constructor(private readonly redis: StorageRedis) {}

  // ─── Owners ───────────────────────────────────────────────────────────

  async createOwner(owner: Owner): Promise<void> {
    const k = KEY.owner(owner.telegram_id);
    await this.redis.hset(k, "telegram_id", String(owner.telegram_id), "name", owner.name, "created_at", owner.created_at);
    await this.redis.sadd(KEY.ownersAll, String(owner.telegram_id));
  }

  async getOwner(telegramId: number): Promise<Owner | null> {
    const raw = await this.redis.hgetall(KEY.owner(telegramId));
    if (!raw || Object.keys(raw).length === 0) return null;
    return {
      telegram_id: Number(raw["telegram_id"]),
      name: raw["name"] ?? "",
      created_at: raw["created_at"] ?? "",
    };
  }

  async listOwners(): Promise<Owner[]> {
    const ids = await this.redis.smembers(KEY.ownersAll);
    const owners: Owner[] = [];
    for (const id of ids) {
      const o = await this.getOwner(Number(id));
      if (o) owners.push(o);
    }
    return owners;
  }

  async deleteOwner(telegramId: number): Promise<void> {
    const sid = String(telegramId);
    await this.redis.del(KEY.owner(telegramId));
    await this.redis.srem(KEY.ownersAll, sid);
  }

  // ─── Settings ─────────────────────────────────────────────────────────

  async saveSettings(settings: Settings): Promise<void> {
    const now = new Date().toISOString();
    const s = { ...settings, updated_at: now };
    await this.redis.hset(
      KEY.settingsGlobal,
      "open_time", s.open_time,
      "close_time", s.close_time,
      "timezone", s.timezone,
      "sitting_length", String(s.sitting_length),
      "slot_increment", String(s.slot_increment),
      "reminder_lead_time", String(s.reminder_lead_time),
      "created_at", s.created_at ?? now,
      "updated_at", s.updated_at,
    );
  }

  async getSettings(): Promise<Settings | null> {
    const raw = await this.redis.hgetall(KEY.settingsGlobal);
    if (!raw || Object.keys(raw).length === 0) return null;
    return {
      open_time: raw["open_time"] ?? "09:00",
      close_time: raw["close_time"] ?? "22:00",
      timezone: raw["timezone"] ?? "UTC",
      sitting_length: Number(raw["sitting_length"]) || 90,
      slot_increment: Number(raw["slot_increment"]) || 15,
      reminder_lead_time: Number(raw["reminder_lead_time"]) || 120,
      created_at: raw["created_at"] ?? "",
      updated_at: raw["updated_at"] ?? "",
    };
  }

  // ─── Table Types ──────────────────────────────────────────────────────

  async createTableType(tt: TableType): Promise<void> {
    const k = KEY.table(tt.id);
    await this.redis.hset(
      k,
      "id", tt.id,
      "seat_count", String(tt.seat_count),
      "quantity", String(tt.quantity),
      "label", tt.label,
      "created_at", tt.created_at,
    );
    await this.redis.sadd(KEY.tablesAll, tt.id);
  }

  async getTableType(id: string): Promise<TableType | null> {
    const raw = await this.redis.hgetall(KEY.table(id));
    if (!raw || Object.keys(raw).length === 0) return null;
    return {
      id: raw["id"] ?? id,
      seat_count: Number(raw["seat_count"]) || 0,
      quantity: Number(raw["quantity"]) || 0,
      label: raw["label"] ?? "",
      created_at: raw["created_at"] ?? "",
    };
  }

  async listTableTypes(): Promise<TableType[]> {
    const ids = await this.redis.smembers(KEY.tablesAll);
    const tables: TableType[] = [];
    for (const id of ids) {
      const t = await this.getTableType(id);
      if (t) tables.push(t);
    }
    return tables;
  }

  async updateTableType(tt: TableType): Promise<void> {
    const k = KEY.table(tt.id);
    await this.redis.hset(
      k,
      "seat_count", String(tt.seat_count),
      "quantity", String(tt.quantity),
      "label", tt.label,
    );
  }

  async deleteTableType(id: string): Promise<void> {
    await this.redis.del(KEY.table(id));
    await this.redis.srem(KEY.tablesAll, id);
  }

  // ─── Bookings ─────────────────────────────────────────────────────────

  async createBooking(booking: Booking): Promise<void> {
    const bk = KEY.booking(booking.id);
    await this.redis.hset(
      bk,
      "id", booking.id,
      "ref_code", booking.ref_code,
      "guest_telegram_id", String(booking.guest_telegram_id),
      "guest_name", booking.guest_name ?? "",
      "guest_phone", booking.guest_phone ?? "",
      "date", booking.date,
      "start_time", booking.start_time,
      "end_time", booking.end_time,
      "duration", String(booking.duration),
      "party_size", String(booking.party_size),
      "allocated_tables", JSON.stringify(booking.allocated_tables),
      "status", booking.status,
      "created_at", booking.created_at,
      "updated_at", booking.updated_at,
    );
    await this.redis.sadd(KEY.bookingsAll, booking.id);
    await this.redis.sadd(KEY.bookingsByDate(booking.date), booking.id);
    await this.redis.set(KEY.bookingsByRef(booking.ref_code), booking.id);
    if (booking.guest_telegram_id) {
      await this.redis.sadd(`bookings:by-guest:${booking.guest_telegram_id}`, booking.id);
    }
  }

  async getBooking(id: string): Promise<Booking | null> {
    const raw = await this.redis.hgetall(KEY.booking(id));
    if (!raw || Object.keys(raw).length === 0) return null;
    let allocated_tables: TableAllocation[] = [];
    try {
      allocated_tables = JSON.parse(raw["allocated_tables"] ?? "[]") as TableAllocation[];
    } catch { /* keep default */ }
    return {
      id: raw["id"] ?? id,
      ref_code: raw["ref_code"] ?? "",
      guest_telegram_id: Number(raw["guest_telegram_id"]) || 0,
      guest_name: raw["guest_name"] || null,
      guest_phone: raw["guest_phone"] || null,
      date: raw["date"] ?? "",
      start_time: raw["start_time"] ?? "",
      end_time: raw["end_time"] ?? "",
      duration: Number(raw["duration"]) || 0,
      party_size: Number(raw["party_size"]) || 0,
      allocated_tables,
      status: (raw["status"] as BookingStatus) ?? "confirmed",
      created_at: raw["created_at"] ?? "",
      updated_at: raw["updated_at"] ?? "",
    };
  }

  async getBookingByRef(refCode: string): Promise<Booking | null> {
    const id = await this.redis.get(KEY.bookingsByRef(refCode));
    if (!id) return null;
    return this.getBooking(id);
  }

  async listBookingsByDate(date: string): Promise<Booking[]> {
    const ids = await this.redis.smembers(KEY.bookingsByDate(date));
    const bookings: Booking[] = [];
    for (const id of ids) {
      const b = await this.getBooking(id);
      if (b) bookings.push(b);
    }
    return bookings;
  }

  async listBookingsByGuest(telegramId: number): Promise<Booking[]> {
    const ids = await this.redis.smembers(`bookings:by-guest:${telegramId}`);
    const bookings: Booking[] = [];
    for (const id of ids) {
      const b = await this.getBooking(id);
      if (b) bookings.push(b);
    }
    return bookings;
  }

  async listAllBookings(): Promise<Booking[]> {
    const ids = await this.redis.smembers(KEY.bookingsAll);
    const bookings: Booking[] = [];
    for (const id of ids) {
      const b = await this.getBooking(id);
      if (b) bookings.push(b);
    }
    return bookings;
  }

  async updateBooking(id: string, updates: Partial<Booking>): Promise<void> {
    const b = await this.getBooking(id);
    if (!b) return;
    const args: string[] = [];
    if (updates.guest_name !== undefined) args.push("guest_name", updates.guest_name ?? "");
    if (updates.guest_phone !== undefined) args.push("guest_phone", updates.guest_phone ?? "");
    if (updates.date !== undefined) args.push("date", updates.date);
    if (updates.start_time !== undefined) args.push("start_time", updates.start_time);
    if (updates.end_time !== undefined) args.push("end_time", updates.end_time);
    if (updates.duration !== undefined) args.push("duration", String(updates.duration));
    if (updates.party_size !== undefined) args.push("party_size", String(updates.party_size));
    if (updates.allocated_tables !== undefined) args.push("allocated_tables", JSON.stringify(updates.allocated_tables));
    if (updates.status !== undefined) args.push("status", updates.status);
    if (updates.updated_at !== undefined) args.push("updated_at", updates.updated_at);
    if (args.length > 0) {
      await this.redis.hset(KEY.booking(id), ...args);
    }
  }

  async updateBookingStatus(id: string, status: BookingStatus): Promise<void> {
    await this.updateBooking(id, {
      status,
      updated_at: new Date().toISOString(),
    });
  }

  async deleteBooking(id: string): Promise<void> {
    const b = await this.getBooking(id);
    if (!b) return;
    await this.redis.del(KEY.booking(id));
    await this.redis.srem(KEY.bookingsAll, id);
    await this.redis.srem(KEY.bookingsByDate(b.date), id);
    await this.redis.del(KEY.bookingsByRef(b.ref_code));
    if (b.guest_telegram_id) {
      await this.redis.srem(`bookings:by-guest:${b.guest_telegram_id}`, id);
    }
    await this.redis.del(KEY.allocation(id));
  }

  // ─── Allocations ──────────────────────────────────────────────────────

  async saveAllocation(allocation: AllocationDetail): Promise<void> {
    const k = KEY.allocation(allocation.booking_id);
    await this.redis.hset(
      k,
      "booking_id", allocation.booking_id,
      "table_types", JSON.stringify(allocation.table_types),
      "created_at", allocation.created_at,
    );
  }

  async getAllocation(bookingId: string): Promise<AllocationDetail | null> {
    const raw = await this.redis.hgetall(KEY.allocation(bookingId));
    if (!raw || Object.keys(raw).length === 0) return null;
    let table_types: TableAllocation[] = [];
    try {
      table_types = JSON.parse(raw["table_types"] ?? "[]") as TableAllocation[];
    } catch { /* keep default */ }
    return {
      booking_id: raw["booking_id"] ?? bookingId,
      table_types,
      created_at: raw["created_at"] ?? "",
    };
  }

  async deleteAllocation(bookingId: string): Promise<void> {
    await this.redis.del(KEY.allocation(bookingId));
  }
}

export function createStorage(redis: StorageRedis): Storage {
  return new Storage(redis);
}

/**
 * Build a Storage backed by a real ioredis client at `url`. ioredis is loaded
 * lazily via createRequire so a bot that never calls this doesn't pull it in.
 */
export function defaultRedisStorageFactory(url: string): Storage {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ioredis: any = require("ioredis");
  const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
  const client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  return new Storage(client as StorageRedis);
}

export { KEY };
