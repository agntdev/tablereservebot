import { runSpec } from "./src/toolkit/harness/runner.js";
import { makeBot } from "./src/harness-entry.js";

async function main() {
  const bot = makeBot();
  const spec = {
    name: "empty guest name is rejected in interactive booking",
    steps: [
      {
        send: { text: "/book 2026-06-25 19:00 2" },
        expect: [
          {
            method: "sendMessage",
            payload: {
              text: "Please enter the guest name for the reservation:"
            }
          }
        ]
      },
      {
        send: { text: "  " },
        expect: [
          {
            method: "sendMessage",
            payload: {
              text: "Please enter a valid guest name."
            }
          }
        ]
      }
    ]
  };

  const result = await runSpec(bot, spec as any);
  console.log("OK:", result.ok);
  if (!result.ok) {
    for (const step of result.steps) {
      if (!step.ok) {
        console.log("STEP failed:", step.failures);
        console.log("Captured calls:", JSON.stringify(step.captured));
      }
    }
  }
}
main().catch(console.error);
