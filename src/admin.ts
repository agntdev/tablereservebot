import type { Context } from "grammy";

export function isAdmin(ctx: Context): boolean {
  const raw = process.env.ADMIN_IDS ?? "";
  if (!raw.trim()) return false;

  const adminIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);

  const userId = ctx.from?.id;
  if (userId === undefined) return false;

  return adminIds.includes(userId);
}
