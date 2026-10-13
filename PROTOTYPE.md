# Futly connected prototype

The sibling Turf-app customer interface, desktop ERP and staff phone console
share one booking ledger, with SQLite for the local demonstration or Supabase
PostgreSQL for the connected prototype. A customer reservation is created as an
app-origin booking and participates in the same overlap checks, holds,
maintenance blocks, session operations and payments as counter bookings.

## Start the demonstration

Keep the repositories beside each other as `turf-erp` and `Turf-app`. From
the ERP folder, with Node 22.5+ installed:

```sh
npm run prototype
```

Open these addresses on the same computer:

| Screen | Address |
| --- | --- |
| Customer booking | http://127.0.0.1:5174/book/ |
| Desktop ERP | http://127.0.0.1:5174/ |
| Staff phone | http://127.0.0.1:5174/m |

Staff demo sign-in is `demo@turf.test` / `PrototypeDemo2026!`, unless changed
or overridden. The script creates the account only in an empty demo database.
It uses `data/prototype.sqlite`; ordinary `npm start` continues using the
operational database. All bookings and receipts persist across restarts.

1. Customer: choose a pitch, tomorrow, a duration and kickoff. Enter a name/team
   and contact, then confirm. Show the booking code and calendar download.
2. Desktop: select the same day. Show the app-origin booking occupying the pitch.
3. Staff phone: open Money, collect the booking, and mark the actual tender received.
4. Customer: open My bookings. The staff receipt updates the amount paid and balance.
5. Create an unpaid future booking and cancel it in My bookings; the slot reopens.
   A staff maintenance block also removes that time from customer availability.

Customer, desktop and staff phone receive committed-change events while open,
with periodic refresh as a fallback. Check-in and pause/resume are shared server
state; pausing keeps the pitch occupied and freezes the same clock on both consoles.
Confirmation always rechecks availability on the server, so polling delays
cannot create overlapping bookings.

## Configuration and development

`TURF_CUSTOMER_APP_DIR` overrides the sibling customer checkout location.
`TURF_VENUE_SLUG`, `TURF_VENUE_NAME`, `TURF_VENUE_LOCATION`,
`TURF_VENUE_PHONE` and `TURF_TIME_ZONE` configure the demo venue.
Pitch names/rates, 06:00–midnight opening, one-hour minimum, 30-minute steps
and the ₹300 floodlight charge after 18:00 come from the ERP.

The customer repo can also run independently with `npm start`, on port 4173.
Its server proxies only `/api/public/` to `TURF_API_URL` (default
`http://127.0.0.1:5174`). This keeps browser cookies and CSRF requests on one
origin; staff APIs are unavailable through that proxy. `/book/` is the simplest
demonstration route and requires only the ERP process.

The current prototype runs on port **5195** against the dedicated Futly Supabase
project. Start it with `npm run start:supabase`; staff credentials are preserved
from the operational ledger. The approved operator test login is stored privately
in `.env.supabase-test.local`. Hosted evidence is in
`artifacts/supabase-verification/HOSTED-REPORT.md`.

See [SUPABASE.md](SUPABASE.md) for the cloud mode, migration and verification status.

## Public API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/public/session` | Guest cookie and CSRF token |
| GET | `/api/public/events` | Generic committed-change notification stream |
| GET | `/api/public/venues` | Venue, pitches, rates and policy |
| GET | `/api/public/venues/:slug/availability?date=YYYY-MM-DD` | Anonymous occupied intervals |
| POST | `/api/public/venues/:slug/holds` | Atomically reserve a slot for up to 20 minutes |
| POST | `/api/public/venues/:slug/holds/:id/confirm` | Confirm as an app-origin booking |
| GET | `/api/public/bookings` | Current browser's booking history and balances |
| POST | `/api/public/bookings/:id/cancel` | Cancel own unpaid future booking |

Mutation requests need `X-CSRF-Token` from the session endpoint and the guest
cookie. Hold payloads include `date`, numeric `pitch`, `start` and `end` in
minutes, `team`, `contact` and an `idempotencyKey`. Repeating a request/confirmation
returns its existing reservation/booking. Prices are computed by the server.
Anonymous availability excludes names, contacts, booking IDs and receipts.

## Prototype boundary

This is one demo venue with three ERP pitches. Customer history belongs to a
30-day browser cookie; clearing it or changing device requires staff assistance.
Phone numbers are contact details, not verified identities. Payment collection
records money received by staff; it does not charge a card or UPI account.
Paid-booking changes and refunds require staff reconciliation.

For live launch, implement verified customer accounts, multiple venue tenancy
and onboarding, real payment/refund integration and notifications, public HTTPS
hosting, backups/monitoring, and physical-phone acceptance testing. The Supabase
prototype hydrates an in-memory domain workspace per request; replace full-ledger
reads with scoped database operations before scaling to multiple busy venues.

## Validation

`npm run check` passes 44 domain/regression tests plus source syntax checks.
The customer repo's `npm run check` passes. Chrome browser verification covered
customer booking, desktop and staff-phone visibility, staff receipt → customer
balance, cancellation, maintenance → customer refresh, guest isolation, CSRF,
reload and server-restart persistence, calendar download and standalone proxy
confirmation. Customer views were rendered at 360, 390, 430 and 1440 pixels.
These are emulated browser views, not tests on physical phones.
