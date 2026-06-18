import { runSpec } from "./src/toolkit/harness/runner.js";
import { makeBot } from "./src/harness-entry.js";

async function main() {
  const bot = makeBot();

  // Test the calendar-path spec from fix-9e839d40a9ff6038.json
  const spec = {
    name: "slot book with empty guest name is rejected",
    steps: [
      { send: { text: "/calendar" }, expect: [{ method: "sendMessage" }] },
      { send: { callback: "cal:pick:2026-06-25" }, expect: [{ method: "editMessageText" }, { method: "sendMessage" }] },
      { send: { callback: "party:1" }, expect: [{ method: "editMessageText" }, { method: "sendMessage" }] },
      { send: { callback: "slot:pick:09:00" }, expect: [{ method: "editMessageText" }] },
      { send: { callback: "slot:book" }, expect: [{ method: "editMessageText" }] },
      {
        send: { text: "  " },
        expect: [{ method: "sendMessage", payload: { text: "Please enter a valid guest name." } }]
      }
    ]
  };

  const result = await runSpec(bot, spec as any);
  console.log("OK:", result.ok);
  if (!result.ok) {
    for (const step of result.steps) {
      if (!step.ok) {
        console.log("STEP", step.index, "failed:", step.failures);
        console.log("Captured calls:", JSON.stringify(step.captured));
      }
    }
  } else {
    console.log("All steps passed!");
  }
}
main().catch(console.error);