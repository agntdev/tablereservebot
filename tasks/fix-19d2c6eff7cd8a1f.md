# fix-19d2c6eff7cd8a1f — E10T2: Settings button tooltip not implemented in /start handler

**Weight:** 0.0000 (share of project budget)
**Reward:** 0 TBLBOT

The E10T2 task requires adding a tooltip/explanation for the Settings button in the /start message. The test spec `tests/specs/E10T2.json` expects the /start text to include: `"\n\n⚙️ Settings is for restaurant owners to configure opening hours, table inventory, and venue settings — visible only to admin accounts."`. However, the actual /start handler at `src/bot.ts:334-339` does NOT contain this tooltip. The feature was never implemented in code. 

Additionally, the E10T2 test spec uses **pre-E10T1 button labels** (`"📋 About"`, `"🛟 Help"`) which were renamed by E10T1 to `"📋 How to Reserve"` and `"🛟 Need Assistance?"`. Even if the tooltip text were added, this button label mismatch would still cause the test to fail.

## Dialog tests

If this task adds or changes user-facing bot behavior, author its dialog tests as a `BotSpec` JSON array in its OWN file `tests/specs/fix-19d2c6eff7cd8a1f.json`. NEVER edit or append to a shared `tests/specs.json` — concurrent feature PRs would conflict on it. The tests-gate globs and merges all `tests/specs/*.json`.

If this task adds a bot command, declare it in its OWN file `tests/commands/fix-19d2c6eff7cd8a1f.json` (a JSON array of command strings, e.g. `["/start"]`). NEVER edit or append to a shared `tests/commands.json` — same conflict reason. The tests-gate globs, merges + de-duplicates all `tests/commands/*.json`.


## Implementation contract

Ship a COMPLETE, working implementation — not a stub. A task is INCOMPLETE (and will be rejected) even if it compiles and the dialog tests pass when it does any of these:
- **Stubbed code:** empty bodies, `TODO`/`FIXME`, commented-out logic, or `throw new Error("not implemented")`.
- **Fabricated data:** `Math.random()`, hardcoded sample arrays, or canned responses standing in for real computed or fetched values.
- **No in-memory data store:** a `Map`/array/module-level variable used as a database is a defect. Anything that must survive a restart (records, subscriptions, balances, schedules, settings) MUST use the toolkit's persistent storage (Redis-backed), not process memory. (The toolkit's auto-selected session storage is only for ephemeral conversation state.)
- **Broken integrations:** call external APIs against their real contract — correct endpoints, ids and params (e.g. a coin *id* like `the-open-network`, not a ticker like `TON`) — with credentials read from env. Do not invent endpoints or fake responses.
- **Dead code:** new commands/handlers must be registered and reachable from the bot's command surface.
If the spec is genuinely under-specified, implement the smallest REAL slice you can verify and note the gap — never fake behavior to make the PR look complete.
