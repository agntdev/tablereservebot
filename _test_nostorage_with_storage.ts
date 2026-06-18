import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeBot } from "./src/harness-entry.js";
import { runSpec } from "./src/toolkit/harness/runner.js";
import type { BotSpec } from "./src/toolkit/harness/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function main() {
  const specsDir = join(__dirname, "tests", "specs-no-storage");
  const files = (await readdir(specsDir)).filter((f) => f.endsWith(".json"));

  let total = 0;
  let passed = 0;
  const failed: string[] = [];

  for (const file of files) {
    const raw = await readFile(join(specsDir, file), "utf8");
    const specs: BotSpec[] = JSON.parse(raw);

    for (const spec of specs) {
      total++;
      const bot = makeBot();
      const result = await runSpec(bot, spec as BotSpec);

      if (result.ok) {
        passed++;
      } else {
        failed.push(spec.name);
      }
    }
  }

  console.log(`Total: ${total}, Passed: ${passed}, Failed: ${total - passed}`);
  if (failed.length > 0) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f}`);
  }
}
main().catch(console.error);
