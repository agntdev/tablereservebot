import type { StorageRedis } from "./index.js";
import { Storage, createStorage } from "./index.js";
import type { Settings, TableType } from "./types.js";

export function createFakeRedis(): StorageRedis & { store: Map<string, string>; setStore: Map<string, Set<string>> } {
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
    store,
    setStore,
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
        } catch { /* ignore */ }
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
    async hdel(k, ...fields) {
      const raw = store.get(k);
      if (!raw) return 0;
      let obj: Record<string, string>;
      try {
        obj = JSON.parse(raw) as Record<string, string>;
      } catch {
        return 0;
      }
      let count = 0;
      for (const f of fields) {
        if (f in obj) {
          delete obj[f];
          count++;
        }
      }
      if (Object.keys(obj).length === 0) {
        store.delete(k);
      } else {
        store.set(k, JSON.stringify(obj));
      }
      return count;
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
    async srem(k, ...members) {
      const s = getSet(k);
      let count = 0;
      for (const m of members) {
        if (s.has(m)) count++;
        s.delete(m);
      }
      if (s.size === 0) setStore.delete(k);
      return count;
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

export function createTestStorage(): Storage {
  const fakeR = createFakeRedis();
  const storage = createStorage(fakeR);

  const now = "2025-06-15T12:00:00.000Z";

  const settings: Settings = {
    open_time: "09:00",
    close_time: "22:00",
    timezone: "UTC",
    sitting_length: 90,
    slot_increment: 15,
    reminder_lead_time: 120,
    created_at: now,
    updated_at: now,
  };
  fakeR.store.set("settings:global", JSON.stringify({
    open_time: settings.open_time,
    close_time: settings.close_time,
    timezone: settings.timezone,
    sitting_length: String(settings.sitting_length),
    slot_increment: String(settings.slot_increment),
    reminder_lead_time: String(settings.reminder_lead_time),
    created_at: settings.created_at,
    updated_at: settings.updated_at,
  }));

  const t1: TableType = {
    id: "t1",
    seat_count: 4,
    quantity: 5,
    label: "4-seat table",
    created_at: now,
  };
  fakeR.store.set("table:t1", JSON.stringify({
    id: t1.id,
    seat_count: String(t1.seat_count),
    quantity: String(t1.quantity),
    label: t1.label,
    created_at: t1.created_at,
  }));
  fakeR.setStore.set("tables:all", new Set(["t1"]));

  const t2: TableType = {
    id: "t2",
    seat_count: 2,
    quantity: 4,
    label: "2-seat table",
    created_at: now,
  };
  fakeR.store.set("table:t2", JSON.stringify({
    id: t2.id,
    seat_count: String(t2.seat_count),
    quantity: String(t2.quantity),
    label: t2.label,
    created_at: t2.created_at,
  }));
  fakeR.setStore.get("tables:all")!.add("t2");

  return storage;
}
