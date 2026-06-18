# fix-1d69dc9bfaebda93 — Timezone setting stored but never applied to any date/time calculation

**Weight:** 0.0000 (share of project budget)
**Reward:** 0 TBLBOT

The `Settings.timezone` field is persisted and retrievable via `storage.getSettings()`, but it is **never consumed** anywhere in the codebase. All date/time operations use `new Date()` (server local time) or `new Date().toISOString()` (UTC date portion). This means:

- `/calendar` shows "today" based on server/UTC, not restaurant timezone.
- Past-date validation (`dateStr < todayStr`) at `src/bot.ts:84`,`src/bot.ts:433`,`src/availability.ts:16` can reject valid dates or accept past dates depending on TZ offset.
- Slot generation (`src/slots.ts`) uses raw `open_time`/`close_time` without TZ adjustment for the server environment.

**Impact**: For any restaurant not in the server's timezone, calendar, availability, and slot generation are all offset incorrectly.

## Dialog tests

If this task adds or changes user-facing bot behavior, author its dialog tests as a `BotSpec` JSON array in its OWN file `tests/specs/fix-1d69dc9bfaebda93.json`. NEVER edit or append to a shared `tests/specs.json` — concurrent feature PRs would conflict on it. The tests-gate globs and merges all `tests/specs/*.json`.

If this task adds a bot command, declare it in its OWN file `tests/commands/fix-1d69dc9bfaebda93.json` (a JSON array of command strings, e.g. `["/start"]`). NEVER edit or append to a shared `tests/commands.json` — same conflict reason. The tests-gate globs, merges + de-duplicates all `tests/commands/*.json`.


## Implementation contract

Ship a COMPLETE, working implementation — not a stub. A task is INCOMPLETE (and will be rejected) even if it compiles and the dialog tests pass when it does any of these:
- **Stubbed code:** empty bodies, `TODO`/`FIXME`, commented-out logic, or `throw new Error("not implemented")`.
- **Fabricated data:** `Math.random()`, hardcoded sample arrays, or canned responses standing in for real computed or fetched values.
- **No in-memory data store:** a `Map`/array/module-level variable used as a database is a defect. Anything that must survive a restart (records, subscriptions, balances, schedules, settings) MUST use the toolkit's persistent storage (Redis-backed), not process memory. (The toolkit's auto-selected session storage is only for ephemeral conversation state.)
- **Broken integrations:** call external APIs against their real contract — correct endpoints, ids and params (e.g. a coin *id* like `the-open-network`, not a ticker like `TON`) — with credentials read from env. Do not invent endpoints or fake responses.
- **Dead code:** new commands/handlers must be registered and reachable from the bot's command surface.
If the spec is genuinely under-specified, implement the smallest REAL slice you can verify and note the gap — never fake behavior to make the PR look complete.
