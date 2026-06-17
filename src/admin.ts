import type { NextFunction } from "grammy";
import type { BotContext } from "./toolkit/index.js";

function parseAdminIds(): Set<number> {
  const raw = process.env.ADMIN_IDS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n)),
  );
}

export function isAdmin(userId?: number): boolean {
  if (userId == null) return false;
  return parseAdminIds().has(userId);
}

export async function adminGuard(ctx: BotContext, next: NextFunction): Promise<void> {
  if (isAdmin(ctx.from?.id)) {
    await next();
    return;
  }
  await ctx.reply("⛔ You are not authorized to use this command.");
}
