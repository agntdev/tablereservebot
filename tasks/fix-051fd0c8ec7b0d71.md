# fix-051fd0c8ec7b0d71 — Fix: Failing dialog spec: /help lists available commands

**Weight:** 0.0000 (share of project budget)
**Reward:** 0 TBLBOT

**Severity:** high

The Tests-gate replay harness reported spec "/help lists available commands" as failing. 44 spec(s) failed: [/start shows renamed 'How to Reserve' and 'Need Assistance?' buttons menu:about callback still responds after rename menu:help callback still responds after rename /start includes tooltip explaining Settings button is for admins /start message explains button roles /start replies with greeting and reservation steps /calendar shows current month with date grid and navigation date pick confirms selection date pick prompts for party size with quick buttons party size selection prompts for slots and reports missing storage typed party size also prompts for slots without storage interactive booking collects name and phone then reports missing storage skip phone in interactive booking reports missing storage empty guest name is rejected in interactive booking direct /book with name confirms booking with inline buttons /reschedule reports unavailable when persistent storage is not configured cancel:yes confirms cancellation and shows main menu cancel:no dismisses cancellation /mark_noshow with valid ref marks booking as no-show /slots reports unavailable when persistent storage is not configured /book reports unavailable when persistent storage is not configured /book with invalid time format shows error /book with non-numeric party size shows error /book with zero party size shows error /book with negative party size shows error calendar pick with party size 2 reports missing storage calendar pick with typed party size 5 reports missing storage calendar flow with storage shows available slots /start replies with a welcome /start replies with welcome and an inline keyboard main menu menu:about callback replies with about text and the menu menu:help callback replies with help text and the menu menu:settings callback replies with settings text and the menu /help lists available commands /book confirms a valid reservation and allocateFirstFit rejects when existing bookings consume capacity /book with party size exceeding total venue capacity shows exact seat counts booking via /book produces confirmation with View/Reschedule/Cancel inline buttons successful reschedule: booking found, released, slots shown, new slot picked, confirmation emitted calendar slot selection offers book button and completes booking slot book with phone skip completes booking slot book with empty guest name is rejected /book interactive mode clears prior calendar-flow session state so guest name is not intercepted by awaitingPartySize /book rejects a booking when overlapping time slots consume all remaining capacity /start replies with a welcome]

## Dialog tests

If this task adds or changes user-facing bot behavior, author its dialog tests as a `BotSpec` JSON array in its OWN file `tests/specs/fix-051fd0c8ec7b0d71.json`. NEVER edit or append to a shared `tests/specs.json` — concurrent feature PRs would conflict on it. The tests-gate globs and merges all `tests/specs/*.json`.

If this task adds a bot command, declare it in its OWN file `tests/commands/fix-051fd0c8ec7b0d71.json` (a JSON array of command strings, e.g. `["/start"]`). NEVER edit or append to a shared `tests/commands.json` — same conflict reason. The tests-gate globs, merges + de-duplicates all `tests/commands/*.json`.


## Implementation contract

Ship a COMPLETE, working implementation — not a stub. A task is INCOMPLETE (and will be rejected) even if it compiles and the dialog tests pass when it does any of these:
- **Stubbed code:** empty bodies, `TODO`/`FIXME`, commented-out logic, or `throw new Error("not implemented")`.
- **Fabricated data:** `Math.random()`, hardcoded sample arrays, or canned responses standing in for real computed or fetched values.
- **No in-memory data store:** a `Map`/array/module-level variable used as a database is a defect. Anything that must survive a restart (records, subscriptions, balances, schedules, settings) MUST use the toolkit's persistent storage (Redis-backed), not process memory. (The toolkit's auto-selected session storage is only for ephemeral conversation state.)
- **Broken integrations:** call external APIs against their real contract — correct endpoints, ids and params (e.g. a coin *id* like `the-open-network`, not a ticker like `TON`) — with credentials read from env. Do not invent endpoints or fake responses.
- **Dead code:** new commands/handlers must be registered and reachable from the bot's command surface.
If the spec is genuinely under-specified, implement the smallest REAL slice you can verify and note the gap — never fake behavior to make the PR look complete.
