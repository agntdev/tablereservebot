import { describe, expect, it, beforeEach } from "vitest";
import { listBookableSlots } from "../src/availability.js";
import { createStorage, type StorageRedis } from "../src/storage/index.js";
import type { Settings, TableType } from "../src/storage/types.js";

function fakeRedis(): StorageRedis {
  const store = new Map<string, string>();
  const setStore = new Map<string, Set<string>>();

  const getSet = (key: string): Set<string> => {
    let s = setStore.get(key);
    if (!s) {
      s = new Set();
      setStore.set(key, s);
    }
    return s;
  };

  return {
    async get(k) {
      return store.has(k) ? store.get(k)! : null;
    },
    async set(k, v) {
      store.set(k, v);
      return "OK";
    },
    async del(...keys) {
      let count = 0;
      for (const k of keys) {
        if (store.has(k) || setStore.has(k)) count++;
        store.delete(k);
        setStore.delete(k);
      }
      return count;
    },
    async keys(pattern) {
      const prefix = pattern.replace(/\*$/, "");
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
    async hget(k, field) {
      const raw = store.get(k);
      if (!raw) return null;
      try {
        const obj = JSON.parse(raw) as Record<string, string>;
        return obj[field] ?? null;
      } catch {
        return null;
      }
    },
    async hset(k, ...args) {
      let obj: Record<string, string> = {};
      const raw = store.get(k);
      if (raw) {
        try {
          obj = JSON.parse(raw) as Record<string, string>;
        } catch {
          /* ignore */
        }
      }
      let newFields = 0;
      for (let i = 0; i < args.length; i += 2) {
        const field = args[i];
        const value = args[i + 1];
        if (!(field in obj)) newFields++;
        obj[field] = value;
      }
      store.set(k, JSON.stringify(obj));
      return newFields;
    },
    async hgetall(k) {
      const raw = store.get(k);
      if (!raw) return {};
      try {
        return JSON.parse(raw) as Record<string, string>;
      } catch {
        return {};
      }
    },
    async hdel() {
      return 0;
    },
    async sadd(k, ...members) {
      const s = getSet(k);
      let count = 0;
      for (const m of members) {
        if (!s.has(m)) count++;
        s.add(m);
      }
      return count;
    },
    async smembers(k) {
      return [...getSet(k)];
    },
    async srem() {
      return 0;
    },
    async sismember(k, member) {
      return getSet(k).has(member) ? 1 : 0;
    },
    async scard(k) {
      return getSet(k).size;
    },
    async exists(...keys) {
      let count = 0;
      for (const k of keys) {
        if (store.has(k) || setStore.has(k)) count++;
      }
      return count;
    },
    async expire() {
      return 1;
    },
  };
}

describe("listBookableSlots", () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(async () => {
    storage = createStorage(fakeRedis());
    const settings: Settings = {
      open_time: "18:00",
      close_time: "22:00",
      timezone: "UTC",
      sitting_length: 90,
      slot_increment: 60,
      reminder_lead_time: 120,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await storage.saveSettings(settings);

    const table: TableType = {
      id: "t4",
      seat_count: 4,
      quantity: 3,
      label: "4-top",
      created_at: new Date().toISOString(),
    };
    await storage.createTableType(table);
  });

  it("returns bookable slots when tables can seat the party", async () => {
    const result = await listBookableSlots(storage, "2026-06-15", 4);
    expect(result.error).toBeUndefined();
    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.slots[0]?.start).toBe("18:00");
  });

  it("returns error when settings are missing", async () => {
    const empty = createStorage(fakeRedis());
    const result = await listBookableSlots(empty, "2026-06-15", 2);
    expect(result.slots).toEqual([]);
    expect(result.error).toContain("Opening hours are not configured");
  });
});