import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeBot } from "./src/harness-entry-nostorage.js";
import { runSpec } from "./src/toolkit/harness/runner.js";
import type { BotSpec } from "./src/toolkit/harness/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function main() {
  // Run specs from specs-no-storage with the no-storage entry
  for (const dirName of ["specs-no-storage"]) {
    const specsDir = join(__dirname, "tests", dirName);
    const files = await readdir(specsDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    
    let total = 0;
    let passed = 0;
    let failed: string[] = [];
    
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
    
    console.log(`\n=== ${dirName} RESULTS ===`);
    console.log(`Total: ${total}, Passed: ${passed}, Failed: ${total - passed}`);
    if (failed.length > 0) {
      console.log(`Failed:`);
      for (const f of failed.slice(0, 10)) console.log(`  - ${f}`);
    }
  }
}
main().catch(console.error);