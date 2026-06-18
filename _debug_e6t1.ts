import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeBot } from "./src/harness-entry.js";
import { runSpec } from "./src/toolkit/harness/runner.js";
import type { BotSpec } from "./src/toolkit/harness/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function main() {
  const raw = await readFile(join(__dirname, "tests", "specs-no-storage", "E6T1.json"), "utf8");
  const specs: BotSpec[] = JSON.parse(raw);
  
  for (const spec of specs) {
    const bot = makeBot();
    const result = await runSpec(bot, spec);
    console.log("OK:", result.ok);
    console.log("Name:", result.name);
    if (!result.ok) {
      for (const step of result.steps) {
        console.log("  Step OK:", step.ok);
        console.log("  Failures:", step.failures);
        console.log("  Captured:", JSON.stringify(step.captured.map(c => ({ method: c.method, text: c.payload.text?.slice(0, 80) }))));
        console.log("  Error:", step.error);
      }
    }
  }
}
main().catch(console.error);