import {
  inlineButton,
  inlineKeyboard,
  type InlineKeyboardMarkup,
} from "./toolkit/index.js";
import type { Slot } from "./slots.js";

const SLOTS_PER_PAGE = 6;

export function formatSlotLabel(slot: Slot): string {
  return `${slot.start}–${slot.end}`;
}

export function formatSlotsPrompt(
  date: string,
  partySize: number,
  slotCount: number,
): string {
  const slotLabel = slotCount === 1 ? "time slot" : "time slots";
  return (
    `✅ Date: ${date}\nGuests: ${partySize}\n\n` +
    `${slotCount} ${slotLabel} available. Pick a time:`
  );
}

export function buildSlotKeyboard(
  slots: Slot[],
  page: number,
): InlineKeyboardMarkup {
  const start = page * SLOTS_PER_PAGE;
  const pageSlots = slots.slice(start, start + SLOTS_PER_PAGE);
  const rows = pageSlots.map((slot) => [
    inlineButton(formatSlotLabel(slot), `slot:pick:${slot.start}`),
  ]);

  const nav: ReturnType<typeof inlineButton>[] = [];
  if (page > 0) {
    nav.push(inlineButton("« Prev", `slot:page:${page - 1}`));
  }
  if (start + SLOTS_PER_PAGE < slots.length) {
    nav.push(inlineButton("Next »", `slot:page:${page + 1}`));
  }
  if (nav.length > 0) {
    rows.push(nav);
  }

  return inlineKeyboard(rows);
}