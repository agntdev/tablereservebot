import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeBot } from "./src/harness-entry.js";
import { runSpec } from "./src/toolkit/harness/runner.js";
import type { BotSpec } from "./src/toolkit/harness/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function testSpec(file: string, specName: string) {
  const raw = await readFile(join(__dirname, "tests", "specs", file), "utf8");
  const specs: BotSpec[] = JSON.parse(raw);
  const spec = specs.find(s => s.name === specName);
  if (!spec) {
    console.log(`NOT FOUND: ${specName} in ${file}`);
    return;
  }
  // Test with regular harness
  const bot1 = makeBot();
  const r1 = await runSpec(bot1, spec);
  console.log(`${specName}`);
  console.log(`  Regular harness: ${r1.ok ? "PASS" : "FAIL"}${!r1.ok ? " - " + r1.steps.map(s => s.failures?.join("; ")).join(" | ") : ""}`);

  // Test with no-storage harness  
  const { makeBot: makeBotNo } = await import("./src/harness-entry-nostorage.js");
  const bot2 = makeBotNo();
  const r2 = await runSpec(bot2, spec);
  console.log(`  No-storage harness: ${r2.ok ? "PASS" : "FAIL"}${!r2.ok ? " - " + r2.steps.map(s => s.failures?.join("; ")).join(" | ") : ""}`);
}

async function main() {
  // Test a few that should be passing regardless
  await testSpec("fix-92aae902cab2e4a7.json", "/start shows renamed 'How to Reserve' and 'Need Assistance?' buttons");
  await testSpec("fix-1334c2b3a0b60bb1.json", "/start includes tooltip explaining Settings button is for admins");
  await testSpec("fix-63eda90d0a00fb59.json", "/start message explains button roles");
  await testSpec("fix-db823696ca1a7fd1.json", "/start replies with greeting and reservation steps");
  await testSpec("start.json", "/start replies with a welcome");
  await testSpec("start.json", "/start replies with welcome and an inline keyboard");
  await testSpec("T03.json", "/help lists available commands");
  await testSpec("E6T2.json", "/book with invalid time format shows error");
  await testSpec("E6T2.json", "/book with non-numeric party size shows error");
  await testSpec("E6T2.json", "/book with zero party size shows error");
  await testSpec("E6T2.json", "/book with negative party size shows error");
}
main().catch(console.error);