## Summary
A Telegram bot that accepts table reservations, shows only genuinely available time slots based on real table inventory and current bookings, issues immediate confirmations with short reference codes, sends configurable reminders a few hours before service, and allows guests to reschedule or cancel via inline buttons without contacting staff. The owner can configure opening hours, sitting length, table inventory, reminder timing, and view/manage upcoming bookings and no-shows from a protected owner view in Telegram.

## Audience
- Guests: Telegram users who want to reserve tables at the restaurant.
- Owner / staff: one or more admin Telegram accounts who configure the restaurant and manage bookings.

## Core entities
- Owner (admin): Telegram ID, settings (opening hours, timezone, sitting length, slot increment, reminder lead time), notification preference.
- TableType: seat_count, quantity (e.g., 4-seat table x 5).
- Booking: id, ref_code, guest Telegram id, guest name (optional), guest phone (optional), date, start_time, duration, party_size, allocated_tables (table type counts), status (confirmed, cancelled, rescheduled, no-show), created_at, updated_at.
- Availability window / Slot: computed candidate start times (based on opening hours, sitting length, and slot increment).

## Integrations & notification targets
- Telegram Bot API (webhook or long-polling) — primary interface for guests and owner.
- Persistence: PostgreSQL (or equivalent relational DB) for bookings, settings, and inventory.
- Background worker / scheduler (e.g., cron + job queue) for reminders and cleaning stale tentative bookings.
- Optional: CSV export endpoint for owner to download bookings.

Notifications
- Guests: confirmation message with reference code immediately on booking; reminder message (configurable lead time) before booking; reschedule/cancel confirmations.
- Owner(s): Telegram push message for new bookings, cancellations, reschedules, and daily summary (configurable). Owner can query upcoming bookings and mark no-shows.

## Interaction flows
1) Guest onboarding
   - Guest taps Start -> bot shows brief friendly greeting and explains steps.
   - Bot asks for date (calendar picker), then party size (quick buttons / numeric entry), then shows only available time slots for that date that can fit the party and the current table inventory.
   - Guest selects slot -> bot asks for guest name and optional phone number (both optional but recommended); guest confirms.
   - Bot creates booking, allocates specific tables (internal), sends confirmation message with concise reference code and inline buttons: View / Reschedule / Cancel.

2) Reschedule
   - Guest taps Reschedule -> bot repeats date -> party size -> shows only slots available after freeing the current booking (atomic swap). Confirm and update booking; owner notified.

3) Cancel
   - Guest taps Cancel and confirms -> booking marked cancelled, tables freed, owner notified.

4) Owner view & actions (Telegram private chat with bot)
   - Commands: /today (list remaining capacity and bookings for today), /upcoming (next N days list), /booking <ref> (show booking details and actions), /mark_noshow <ref>, /export (CSV), /settings (edit opening hours, sitting length, table inventory, slot increment, reminder lead time, timezone, admin list).
   - Inline action on a booking: Mark no-show, Cancel, Edit.

5) Reminders and no-show handling
   - Bot sends reminder messages to guest X hours before start (configurable; default 2 hours). Owner can later mark a booking as no-show which updates stats.

## Availability & allocation logic (important)
- Slot generation: generate candidate start times inside opening hours at configured slot increment (default 15 minutes), only within [open_time, close_time - sitting_length].
- For each candidate start, simulate allocation of the booking's party size against current active bookings overlapping that interval using table-first-fit allocation by table types (try to assign as few tables as possible). A slot is offered only if algorithm can allocate tables for that party without exceeding inventory.
- When booking confirmed, allocation is persisted (which prevents concurrent double-bookings). The booking lock is atomic to avoid race conditions.

## Persistence
- Store owners, settings, table inventory, bookings, and allocation details in Postgres.
- Index bookings by date/time/ref_code for quick lookups.
- Persist guest contact fields but restrict read access to admin Telegram IDs only.
- Short-lived tentative reservations: if partial flows are left unconfirmed, expire after configurable timeout (default 10 minutes).

## Payments
- No payments handled by the bot.

## Non-goals
- No payment or deposit processing.
- No floorplan drag/drop table map UI (allocation is automatic, textual only).
- No multi-location management in initial scope (single-restaurant). Multi-location may be added later.

## Security & privacy
- Admin access controlled by Telegram user IDs set during setup; owner must supply admin IDs.
- Guest personal data visible only to admins and stored encrypted at rest (DB-level / application-level encryption recommended).
- Bot messages avoid exposing other guests' details.

## Edge cases & graceful handling
- If guest provides an unusual date/time or partial input, bot offers calendar/quick reply fallbacks and clear validation messages.
- If no slots are available on chosen date, bot suggests nearest available times/days and offers to be notified when a slot opens (optional feature later).
- Concurrency: booking operations use DB transactions and optimistic locking to prevent double-booking.

## Operational requirements
- Hosting: a server to run the bot webhook and background scheduler (Heroku, AWS, DigitalOcean, etc.).
- SSL-enabled webhook endpoint for production Telegram bot.
- DB: managed Postgres recommended.

## Assumptions & defaults
- Timezone: restaurant timezone must be configured during setup; default = server timezone (UTC). Rationale: correct slot calculations require a known timezone; default to UTC if owner does not set one.
- Slot increment: 15 minutes. Rationale: balances granularity and UI simplicity; adjustable in settings.
- Default sitting length: 90 minutes. Rationale: common restaurant standard; owner can change per venue.
- Reminder lead time: 2 hours before booking. Rationale: owner requested "a couple of hours"; make it configurable.
- Table inventory model: owner defines table types (seat count + quantity). Rationale: allows correct allocation to avoid overbooking while remaining flexible.
- Admin authentication: owner supplies one or more Telegram admin IDs at setup. Rationale: simple and secure admin access without extra auth systems.
- Reference code: 6-character alphanumeric. Rationale: short and human-readable for guests and staff.
- Persistence: PostgreSQL. Rationale: relational model fits booking and allocation logic and supports transactions.
- Tentative booking expiry: 10 minutes for an in-progress reservation that is not confirmed. Rationale: prevents long holds that block slots.

If you confirm this brief I will begin the build using these defaults and expose settings so you can change slot increment, sitting length, reminder lead time, timezone, and table inventory from the owner settings command.