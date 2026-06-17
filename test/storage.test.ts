import { describe, expect, it, beforeEach } from "vitest";
import { createStorage } from "../src/storage/index.js";
import { createFakeRedis } from "../src/storage/fake.js";
import type {
  AllocationDetail,
  Booking,
  Owner,
  Settings,
  TableType,
} from "../src/storage/types.js";

function makeOwner(id: number, name = "Test Owner"): Owner {
  return {
    telegram_id: id,
    name,
    created_at: new Date().toISOString(),
  };
}

function makeSettings(overrides?: Partial<Settings>): Settings {
  return {
    open_time: "09:00",
    close_time: "22:00",
    timezone: "UTC",
    sitting_length: 90,
    slot_increment: 15,
    reminder_lead_time: 120,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeTableType(id: string, seatCount = 4, quantity = 5): TableType {
  return {
    id,
    seat_count: seatCount,
    quantity,
    label: `${seatCount}-seat table`,
    created_at: new Date().toISOString(),
  };
}

function makeBooking(overrides?: Partial<Booking>): Booking {
  return {
    id: "b1",
    ref_code: "ABC123",
    guest_telegram_id: 111,
    guest_name: "John Doe",
    guest_phone: null,
    date: "2025-06-15",
    start_time: "18:00",
    end_time: "19:30",
    duration: 90,
    party_size: 4,
    allocated_tables: [{ table_type_id: "t1", count: 1 }],
    status: "confirmed",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("Storage — Owners", () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    const redis = createFakeRedis();
    storage = createStorage(redis);
  });

  it("creates and retrieves an owner", async () => {
    const owner = makeOwner(12345, "Alice");
    await storage.createOwner(owner);
    const got = await storage.getOwner(12345);
    expect(got).toEqual(owner);
  });

  it("returns null for a non-existent owner", async () => {
    const got = await storage.getOwner(99999);
    expect(got).toBeNull();
  });

  it("lists all owners", async () => {
    await storage.createOwner(makeOwner(1, "Alice"));
    await storage.createOwner(makeOwner(2, "Bob"));
    const owners = await storage.listOwners();
    expect(owners).toHaveLength(2);
    expect(owners.map((o) => o.telegram_id).sort()).toEqual([1, 2]);
  });

  it("deletes an owner", async () => {
    await storage.createOwner(makeOwner(1, "Alice"));
    await storage.createOwner(makeOwner(2, "Bob"));
    await storage.deleteOwner(1);
    const owners = await storage.listOwners();
    expect(owners).toHaveLength(1);
    expect(owners[0].telegram_id).toBe(2);
    expect(await storage.getOwner(1)).toBeNull();
  });
});

describe("Storage — Settings", () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    const redis = createFakeRedis();
    storage = createStorage(redis);
  });

  it("saves and retrieves settings", async () => {
    const settings = makeSettings();
    await storage.saveSettings(settings);
    const got = await storage.getSettings();
    expect(got?.open_time).toBe("09:00");
    expect(got?.close_time).toBe("22:00");
    expect(got?.timezone).toBe("UTC");
    expect(got?.sitting_length).toBe(90);
    expect(got?.slot_increment).toBe(15);
    expect(got?.reminder_lead_time).toBe(120);
  });

  it("returns null when no settings are stored", async () => {
    const got = await storage.getSettings();
    expect(got).toBeNull();
  });

  it("overwrites settings on subsequent saves", async () => {
    await storage.saveSettings(makeSettings({ sitting_length: 60 }));
    await storage.saveSettings(makeSettings({ sitting_length: 120 }));
    const got = await storage.getSettings();
    expect(got?.sitting_length).toBe(120);
  });
});

describe("Storage — Table Types", () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    const redis = createFakeRedis();
    storage = createStorage(redis);
  });

  it("creates and retrieves a table type", async () => {
    const tt = makeTableType("t1", 4, 5);
    await storage.createTableType(tt);
    const got = await storage.getTableType("t1");
    expect(got).toEqual(tt);
  });

  it("returns null for a non-existent table type", async () => {
    expect(await storage.getTableType("nope")).toBeNull();
  });

  it("lists all table types", async () => {
    await storage.createTableType(makeTableType("t1", 2, 3));
    await storage.createTableType(makeTableType("t2", 4, 5));
    const tables = await storage.listTableTypes();
    expect(tables).toHaveLength(2);
  });

  it("updates a table type", async () => {
    await storage.createTableType(makeTableType("t1", 2, 3));
    await storage.updateTableType({
      id: "t1",
      seat_count: 6,
      quantity: 10,
      label: "Big table",
      created_at: "",
    });
    const got = await storage.getTableType("t1");
    expect(got?.seat_count).toBe(6);
    expect(got?.quantity).toBe(10);
    expect(got?.label).toBe("Big table");
  });

  it("deletes a table type", async () => {
    await storage.createTableType(makeTableType("t1"));
    await storage.createTableType(makeTableType("t2"));
    await storage.deleteTableType("t1");
    const tables = await storage.listTableTypes();
    expect(tables).toHaveLength(1);
    expect(tables[0].id).toBe("t2");
  });
});

describe("Storage — Bookings", () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    const redis = createFakeRedis();
    storage = createStorage(redis);
  });

  it("creates and retrieves a booking by id", async () => {
    const b = makeBooking();
    await storage.createBooking(b);
    const got = await storage.getBooking("b1");
    expect(got?.ref_code).toBe("ABC123");
    expect(got?.guest_telegram_id).toBe(111);
    expect(got?.party_size).toBe(4);
    expect(got?.status).toBe("confirmed");
  });

  it("retrieves a booking by ref code", async () => {
    const b = makeBooking({ id: "b1", ref_code: "XYZ789" });
    await storage.createBooking(b);
    const got = await storage.getBookingByRef("XYZ789");
    expect(got?.id).toBe("b1");
  });

  it("returns null for unknown ref code", async () => {
    expect(await storage.getBookingByRef("NOPE")).toBeNull();
  });

  it("lists bookings by date", async () => {
    await storage.createBooking(makeBooking({ id: "b1", date: "2025-06-15" }));
    await storage.createBooking(makeBooking({ id: "b2", date: "2025-06-15" }));
    await storage.createBooking(makeBooking({ id: "b3", date: "2025-06-16" }));
    const on15 = await storage.listBookingsByDate("2025-06-15");
    expect(on15).toHaveLength(2);
    const on16 = await storage.listBookingsByDate("2025-06-16");
    expect(on16).toHaveLength(1);
  });

  it("lists bookings by guest", async () => {
    await storage.createBooking(makeBooking({ id: "b1", guest_telegram_id: 111 }));
    await storage.createBooking(makeBooking({ id: "b2", guest_telegram_id: 111 }));
    await storage.createBooking(makeBooking({ id: "b3", guest_telegram_id: 222 }));
    const guest111 = await storage.listBookingsByGuest(111);
    expect(guest111).toHaveLength(2);
    const guest222 = await storage.listBookingsByGuest(222);
    expect(guest222).toHaveLength(1);
  });

  it("lists all bookings", async () => {
    await storage.createBooking(makeBooking({ id: "b1" }));
    await storage.createBooking(makeBooking({ id: "b2" }));
    const all = await storage.listAllBookings();
    expect(all).toHaveLength(2);
  });

  it("updates booking fields", async () => {
    await storage.createBooking(makeBooking({ id: "b1", guest_name: "Old" }));
    await storage.updateBooking("b1", {
      guest_name: "New",
      party_size: 6,
    });
    const got = await storage.getBooking("b1");
    expect(got?.guest_name).toBe("New");
    expect(got?.party_size).toBe(6);
    expect(got?.ref_code).toBe("ABC123");
  });

  it("updates booking status", async () => {
    await storage.createBooking(makeBooking({ id: "b1" }));
    await storage.updateBookingStatus("b1", "cancelled");
    const got = await storage.getBooking("b1");
    expect(got?.status).toBe("cancelled");
  });

  it("deletes a booking and cleans up indexes", async () => {
    await storage.createBooking(makeBooking({ id: "b1", date: "2025-06-15", ref_code: "ABC", guest_telegram_id: 111 }));
    await storage.deleteBooking("b1");
    expect(await storage.getBooking("b1")).toBeNull();
    expect(await storage.getBookingByRef("ABC")).toBeNull();
    expect(await storage.listBookingsByDate("2025-06-15")).toEqual([]);
    expect(await storage.listBookingsByGuest(111)).toEqual([]);
  });

  it("serializes and deserializes allocated_tables JSON", async () => {
    const alloc = [{ table_type_id: "t1", count: 2 }, { table_type_id: "t2", count: 1 }];
    await storage.createBooking(makeBooking({ id: "b1", allocated_tables: alloc }));
    const got = await storage.getBooking("b1");
    expect(got?.allocated_tables).toEqual(alloc);
  });

  it("handles null guest_name and guest_phone", async () => {
    await storage.createBooking(makeBooking({ id: "b1", guest_name: null, guest_phone: null }));
    const got = await storage.getBooking("b1");
    expect(got?.guest_name).toBeNull();
    expect(got?.guest_phone).toBeNull();
  });
});

describe("Storage — Allocations", () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    const redis = createFakeRedis();
    storage = createStorage(redis);
  });

  it("saves and retrieves an allocation", async () => {
    const a: AllocationDetail = {
      booking_id: "b1",
      table_types: [{ table_type_id: "t1", count: 1 }],
      created_at: new Date().toISOString(),
    };
    await storage.saveAllocation(a);
    const got = await storage.getAllocation("b1");
    expect(got).toEqual(a);
  });

  it("returns null for non-existent allocation", async () => {
    expect(await storage.getAllocation("nonexistent")).toBeNull();
  });

  it("deletes an allocation", async () => {
    const a: AllocationDetail = {
      booking_id: "b1",
      table_types: [],
      created_at: new Date().toISOString(),
    };
    await storage.saveAllocation(a);
    await storage.deleteAllocation("b1");
    expect(await storage.getAllocation("b1")).toBeNull();
  });
});
