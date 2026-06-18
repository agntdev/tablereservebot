import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeBot } from "./src/harness-entry.js";
import { runSpec } from "./src/toolkit/harness/runner.js";
import type { BotSpec } from "./src/toolkit/harness/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function main() {
  const specsDir = join(__dirname, "tests", "specs");
  const files = await readdir(specsDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  
  let total = 0;
  let passed = 0;
  const failed: string[] = [];
  
  for (const file of jsonFiles) {
    const raw = await readFile(join(specsDir, file), "utf8");
    const specs: BotSpec[] = JSON.parse(raw);
    
    for (const spec of specs) {
      total++;
      const bot = makeBot();
      const result = await runSpec(bot, spec as BotSpec);
      
      if (result.ok) {
        passed++;
      } else {
        const failures = result.steps.filter(s => !s.ok).map(s => s.failures?.join("; ")).join(" | ");
        failed.push(`${spec.name} (${file}): ${failures}`);
      }
    }
  }
  
  console.log(`\n=== RESULTS ===`);
  console.log(`Total: ${total}, Passed: ${passed}, Failed: ${total - passed}`);
  if (failed.length > 0) {
    console.log(`\nFailed specs:`);
    for (const f of failed.slice(0, 20)) {
      console.log(`  - ${f}`);
    }
    if (failed.length > 20) {
      console.log(`  ... and ${failed.length - 20} more`);
    }
  }
}
main().catch(console.error);
