import {
  inlineButton,
  inlineKeyboard,
  type InlineKeyboardMarkup,
} from "./toolkit/index.js";

export const PARTY_SIZE_PROMPT =
  "How many guests? Pick a quick option or type a number.";

const QUICK_PARTY_SIZES = [2, 4, 6, 8] as const;

export function buildPartySizeKeyboard(): InlineKeyboardMarkup {
  return inlineKeyboard([
    QUICK_PARTY_SIZES.slice(0, 2).map((size) =>
      inlineButton(String(size), `party:${size}`),
    ),
    QUICK_PARTY_SIZES.slice(2, 4).map((size) =>
      inlineButton(String(size), `party:${size}`),
    ),
    [inlineButton("Type a number", "party:type")],
  ]);
}

export function parsePartySizeInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const size = Number.parseInt(trimmed, 10);
  if (size < 1 || size > 99) {
    return null;
  }

  return size;
}

export function formatPartySizePrompt(dateStr: string): string {
  return `✅ Date: ${dateStr}\n\n${PARTY_SIZE_PROMPT}`;
}

export function formatPartySizeConfirmation(
  dateStr: string,
  partySize: number,
): string {
  return `✅ Date: ${dateStr}\nGuests: ${partySize}`;
}