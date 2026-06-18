import type { StorageRedis } from "./index.js";

export interface MemoryStorageRedis extends StorageRedis {
  store: Map<string, string>;
  setStore: Map<string, Set<string>>;
}

export function createMemoryStorageRedis(): MemoryStorageRedis {
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
    async set(k, v, ...args) {
      const nxIdx = args.indexOf("NX");
      if (nxIdx >= 0) {
        if (store.has(k)) return null;
        store.set(k, v);
        return "OK";
      }
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