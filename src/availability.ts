import { allocateFirstFit } from "./allocate.js";
import type { Storage } from "./storage/index.js";
import { generateSlots, type Slot } from "./slots.js";

export interface AvailableSlotsResult {
  slots: Slot[];
  error?: string;
}

export async function listBookableSlots(
  storage: Storage,
  date: string,
  partySize: number,
): Promise<AvailableSlotsResult> {
  const settings = await storage.getSettings();
  if (!settings) {
    return {
      slots: [],
      error:
        "Opening hours are not configured yet. A venue admin must set them up first.",
    };
  }

  const candidates = generateSlots(settings);
  if (candidates.length === 0) {
    return {
      slots: [],
      error:
        "No available slots within the configured opening hours. Check the venue settings.",
    };
  }

  const bookable: Slot[] = [];
  for (const slot of candidates) {
    const result = await allocateFirstFit(
      storage,
      date,
      slot.start,
      slot.end,
      partySize,
    );
    if (result.success) {
      bookable.push(slot);
    }
  }

  if (bookable.length === 0) {
    return {
      slots: [],
      error: `No time slots can seat ${partySize} guests on ${date}. Try another date or party size.`,
    };
  }

  return { slots: bookable };
}

export async function findNearbyAvailableDates(
  storage: Storage,
  date: string,
  partySize: number,
  maxSearchDays: number = 5,
): Promise<string[]> {
  const base = new Date(date + "T00:00:00");
  if (isNaN(base.getTime())) return [];

  const found: string[] = [];
  for (let d = 1; d <= maxSearchDays; d++) {
    const next = new Date(base);
    next.setDate(next.getDate() + d);
    const dateStr = next.toISOString().slice(0, 10);
    const result = await listBookableSlots(storage, dateStr, partySize);
    if (result.slots.length > 0) {
      found.push(dateStr);
      if (found.length >= 3) break;
    }
  }

  return found;
}