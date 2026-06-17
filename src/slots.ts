import type { Settings } from "./storage/types.js";

export interface Slot {
  start: string;
  end: string;
}

export function generateSlots(settings: Settings): Slot[] {
  const openMinutes = parseTime(settings.open_time);
  const closeMinutes = parseTime(settings.close_time);
  const closeEffective =
    closeMinutes <= openMinutes ? closeMinutes + 24 * 60 : closeMinutes;
  const lastStart = closeEffective - settings.sitting_length;

  const slots: Slot[] = [];
  for (let m = openMinutes; m <= lastStart; m += settings.slot_increment) {
    slots.push({
      start: formatTime(m),
      end: formatTime(m + settings.sitting_length),
    });
  }
  return slots;
}

function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function formatTime(absoluteMinutes: number): string {
  const total = ((absoluteMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
