import { buildBot } from "./bot.js";
import { createTestStorage } from "./storage/fake.js";

// The Tests-gate harness imports THIS module and calls makeBot() with no args,
// replaying dialog specs tokenlessly (it fakes the Bot API transport — no real
// Telegram call is made). The token is a placeholder for replay. The agntdev-ci
// orchestrator points AGNTDEV_BOT_MODULE at the compiled dist/harness-entry.js.
export function makeBot() {
  return buildBot(process.env.BOT_TOKEN ?? "harness-test-token", {
    storage: createTestStorage(),
    now: "2025-06-15T12:00:00.000Z",
  });
}
