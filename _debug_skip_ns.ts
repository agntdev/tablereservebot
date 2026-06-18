import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { makeBot } from "./src/harness-entry-nostorage.js";
import { runSpec } from "./src/toolkit/harness/runner.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const raw = readFileSync(join(__dirname, "tests", "specs", "fix-9e839d40a9ff6038.json"), "utf8");
const specs = JSON.parse(raw);

const spec = specs[1]; // "slot book with phone skip completes booking"
console.log("Spec name:", spec.name);

const bot = makeBot();
const result = await runSpec(bot, spec as any);
console.log("OK:", result.ok);
if (!result.ok) {
  for (const step of result.steps) {
    console.log(`\nStep ${step.index}: ok=${step.ok}`);
    if (step.captured) {
      console.log("  Captured calls:");
      for (const c of step.captured) {
        console.log(`    ${c.method}: ${JSON.stringify(c.payload)}`.slice(0, 500));
      }
    }
    if (step.failures) {
      console.log("  Failures:", step.failures);
    }
    if (step.error) {
      console.log("  Error:", step.error);
    }
  }
}
