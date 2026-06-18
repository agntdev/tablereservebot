import { makeBot } from "./dist/harness-entry.js";
import { runSpec } from "./dist/toolkit/harness/runner.js";
import { readFile } from "node:fs/promises";

const specs = JSON.parse(await readFile("./tests/specs/E1T2.json", "utf8"));

for (const spec of specs) {
  const result = await runSpec(makeBot(), spec);
  console.log(result.ok ? "✓" : "✗", result.name);
  if (!result.ok) {
    for (const step of result.steps) {
      if (!step.ok) {
        console.log("  Failures:", JSON.stringify(step.failures));
        console.log("  Captured:", JSON.stringify(step.captured[0]?.payload?.reply_markup?.inline_keyboard?.map(r => r.map(b => b.text))));
      }
    }
  }
}
