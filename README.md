# Turf Operations — booking console

An authenticated operations system for a multi-pitch football turf: availability,
bookings and holds, live sessions, payment collection, reminders, audit history,
and all-pitch utilisation reporting.

The repository now contains a product foundation rather than a browser-only
prototype. Operational state is persisted in SQLite and enforced by a server-side
domain layer. The vanilla JavaScript UI is retained, but it cannot write booking
state without an authenticated API session.

## What is implemented

- Password authentication with `HttpOnly`, `SameSite=Strict` sessions, CSRF
  protection, origin checks, login throttling, and 12-hour session expiry.
- Operator, manager, and owner roles. Managers control destructive releases,
  maintenance, status reversals, and discounts; owners can create staff accounts.
- One persisted booking ledger shared by Availability, Sessions, Reminders, and
  Dashboard. Custom and multi-date bookings use the same records as standard slots.
- Transactional overlap enforcement across confirmed bookings, active 20-minute
  holds, and maintenance blocks. Batch/group reservations succeed completely or
  not at all.
- Collision- and closing-time-safe session extensions with price recalculation.
- Append-only payment events. The original booking price is preserved, extensions
  update the total, and discounts require a reason plus manager/owner authority.
- A server-persisted default deposit is configurable by managers and owners,
  shared across consoles, prefilled for advance collection, and audit logged.
- Server-authored operational audit events, visible to managers in Settings.
- Security headers, a static-file allowlist, bounded JSON bodies, bounded date
  queries, and an intentionally private default bind address.

## Run locally

Node 22.5 or newer is required for the built-in SQLite driver.

```bash
export TURF_BOOTSTRAP_EMAIL="owner@example.com"
export TURF_BOOTSTRAP_PASSWORD="replace-with-a-long-unique-password"
export TURF_BOOTSTRAP_NAME="Venue Owner"
npm start
```

Open `http://127.0.0.1:5174`. The bootstrap account is created only when the
database has no users. Subsequent staff accounts are created by an owner under
Settings. The database defaults to `data/turf.sqlite`; set
`TURF_DATABASE_PATH` to place it on a persistent volume.

For development with automatic restart:

```bash
npm run dev
```

Populate the current operating week with an idempotent, collision-checked demo
schedule through the authenticated API:

```bash
TURF_SEED_EMAIL="owner@example.com" \
TURF_SEED_PASSWORD="your-local-owner-password" \
npm run seed:demo
```

For denser testing data, add a collision-safe schedule across a configurable
number of days. The defaults are 15 additional bookings per day for 10 days:

```bash
TURF_SEED_EMAIL="owner@example.com" \
TURF_SEED_PASSWORD="your-local-owner-password" \
npm run seed:volume
```

## Verify

```bash
npm run check
```

The regression suite covers custom-booking conflicts, atomic group reservations,
hold expiry, extension collisions and closing time, authorization and audit
requirements, and append-only payments/discount approval.

## Architecture

| Path | Responsibility |
|---|---|
| `server.mjs` | HTTP boundary, secure sessions, CSRF, rate limiting, headers, static allowlist, API routes |
| `server/store.mjs` | SQLite schema, transactions, RBAC, booking invariants, payments, audit events |
| `app.js` | Small browser composition entrypoint |
| `client/state.js` | UI state and local appearance preferences |
| `client/api.js` | Authenticated API transport and state synchronization |
| `client/domain.js` | Client-side date, availability, pricing, and display selectors |
| `client/actions.js` | Delegated UI events and server mutation workflows |
| `client/render.js` | View composition, focus/scroll preservation, and live refresh |
| `client/views/*.js` | Independent Availability, Sessions, Reminders, Dashboard, and Settings views |
| `client/modals.js` | Booking, timer, payment, and audited-action dialogs |
| `styles.css` | Design tokens and component styles |
| `tests/store.test.mjs` | Domain-level security and integrity regression tests |

The store is deliberately isolated behind `createStore()`. SQLite is a sensible
single-venue starting point, but a horizontally scaled deployment should replace
that adapter with managed PostgreSQL while retaining the same transactional
invariants and API contracts.

## Production deployment checklist

Do not deploy this version as a static Vercel site: the server and durable database
are required, and a function-local SQLite file is not durable. Deploy the Node
process on a single persistent host/volume or migrate the store to managed
PostgreSQL first.

Before serving real customers:

1. Terminate TLS at the reverse proxy and run with `NODE_ENV=production` so the
   session cookie is `Secure`. Set `TRUST_PROXY=1` only when that proxy overwrites
   client-supplied `X-Forwarded-*` headers.
2. Mount `TURF_DATABASE_PATH` on encrypted persistent storage and configure tested,
   off-host backups plus restore drills.
3. Store bootstrap credentials in a secret manager, start once, then rotate or
   remove the bootstrap secret.
4. Add external observability, alerting, database backup monitoring, and a formal
   retention/export policy for customer and audit data.
5. Move to managed PostgreSQL before multiple application replicas or venues;
   SQLite is intentionally a single-writer, single-deployment foundation.
6. Add password reset/invitation delivery, optional MFA/SSO, account deactivation,
   payment-gateway reconciliation, search/rescheduling, and automated browser tests.

## Product behavior

**Availability** answers the counter question across all pitches or one pitch over
a week. It supports standard, half-hour/custom, temporary hold, maintenance, and
atomic corporate/group bookings.

**Sessions** runs the current local day from those same bookings. Timer/status,
extension, and payment actions are server-authoritative.

**Reminders** derives not-started, overtime, payment-due, hold, and maintenance
alerts from current persisted data.

**Dashboard** reports confirmed booked minutes and collected revenue across all
pitches. Holds and maintenance are not counted as bookings or revenue.

**Settings** contains local appearance preferences, the signed-in role, owner-only
staff creation, and the manager-visible operational audit log.
