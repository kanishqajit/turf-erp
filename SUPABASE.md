# Futly Supabase prototype

The customer booking app, desktop ERP and staff phone console use the same API.
In Supabase mode, PostgreSQL holds staff accounts, sessions, customer reservations,
bookings, maintenance blocks, receipts, venue settings and audit records. The
customer app can run at `/book/` or through its standalone public-API proxy.

## Current verification status

The dedicated **Futly** project is active on the organization's Free plan:
`ofjgkrobvzwqkuqgxdho`, Seoul (`ap-northeast-2`). The private schema and
authenticated `futly-ledger` Edge Function are deployed. The existing paused
Supabase project was not changed. All three routes at port 5195 now use hosted
PostgreSQL, with no persistent SQLite fallback.

`npm run check` covers 44 tests and source parsing. Initial local Chrome verification used
three separate browser contexts, including a 390-pixel staff phone and customer
screen. It checked customer reservation → both already-open staff screens,
staff cash receipt → customer balance, check-in, frozen pause and resume,
guest isolation, overlapping reservations, cancellation and slot reopening,
CSRF, invalid JSON, privacy of conflict errors and persistence after API restart.
Disconnecting PostgreSQL produced HTTP 503 rather than a false success.
There were no browser script errors in the three-screen flow.

Hosted verification on 9 October 2026 exercised customer booking through the
browser, visibility on both already-open staff screens, a synthetic phone cash
receipt updating customer history, shared pause and phone resume, cloud row
verification, simultaneous competing holds (201/409), duplicate confirmation,
unpaid cancellation reopening the slot, guest isolation and operator access
restrictions. API restart preserved the booking, receipt and clock state.
Missing/invalid Edge tokens and anonymous RPC calls returned 401. All three
browser screens reported no console errors. Phone rendering was checked at
390×844. The standalone customer proxy also passed cookie isolation, origin
protection, exclusion of staff APIs and streaming-event checks.

Screenshots and results: `artifacts/supabase-verification/`, with the final
summary in `HOSTED-REPORT.md`. Physical phones remain untested.

Hosted testing found and fixed a financial display bug: the phone till counted
receipts by booking date. It now sums payments and refunds by receipt date in
the venue timezone, including deposits received today for a future match.

A migration rehearsal imported a copy of the operational ledger and compared
every relational record: 2 staff accounts, 310 bookings, 206 receipts and 768
audit records. The original operational ledger was retained.

The same operational import is now verified in hosted Supabase. Original staff
passwords remain intact. The user-approved `demo@turf.test` account has the
operator role; its private random password is saved in `.env.supabase-test.local`
(ignored by Git, owner-only permissions). It cannot manage staff or grant roles.

Security advisors have no warnings or errors after restricting Supabase's
automatic-RLS helper. The 12 informational RLS-without-policy notices are
intentional: private ledger tables deny browser roles and are accessed only by
the trusted service role. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Unused-index informational notices are expected on the new database.

Start the cloud prototype with `npm run start:supabase`. Customer `/book/`,
desktop `/` and phone `/m` are served at `http://127.0.0.1:5195`.
The sibling customer app can run separately using `npm run start:connected`
at port 4173; `.env.connected` points its public-only proxy to port 5195.

## Provision and run

1. Create the dedicated Futly project in the chosen Supabase organization after
   reviewing and confirming its quoted cost. Mumbai (`ap-south-1`) is appropriate
   for the current India demonstration.
2. Apply `supabase/migrations/20261009110515_futly_shared_ledger.sql` to the empty
   project. The migration creates private, RLS-enabled tables and restricted RPCs.
3. Generate a private random server token (48 random bytes encoded as base64url).
   Set `futly.ledger_meta.integration_token_hash` to its SHA-256 hexadecimal hash.
   Keep the raw token only in the server environment.
4. Deploy `supabase/functions/futly-ledger/` as `futly-ledger`, with gateway JWT
   verification disabled. This function implements its own server-token gate;
   the database checks the token before reading or writing any ledger row. It
   uses Supabase's provisioned service-role environment inside the function.
5. Copy `.env.supabase.example` to `.env.supabase.local`, replace placeholders,
   and restrict the file to its owner. Never put the server token or service-role
   key in the customer app, browser bundle, screenshots or Git.
6. Before starting an empty cloud ledger, import existing records if required:

   ```sh
   node --env-file=.env.supabase.local scripts/import-supabase.mjs data/turf.sqlite
   npm run start:supabase
   ```

   Import refuses to overwrite a nonempty cloud ledger, writes a private local
   backup, commits atomically and compares all imported rows. It preserves staff
   password hashes and sessions. Bootstrap credentials create an owner only when
   no staff account exists.
7. Verify `/api/health` reports `persistence: "supabase"`, repeat the browser flow
   against the hosted project, inspect actual cloud rows and security advisors,
   then restart the API to verify durability.

## Persistence and security

The ERP's existing domain rules run in a fresh in-memory SQLite workspace for
each request. PostgreSQL is authoritative; cloud mode writes no SQLite ledger
file and never falls back to one during an outage. Only changed rows are sent
back, under an atomic revision check. Concurrent requests retry their domain
checks on the latest snapshot. Operation IDs make retries after a lost commit
acknowledgement safe. HTTP success and cookies are emitted after durable commit.

The private `futly` schema is unavailable to anonymous and authenticated browser
roles. RPCs are SECURITY INVOKER and executable only by the service role. The
Edge Function checks a high-entropy integration token through the database and
returns sanitized errors. Browser clients retain the existing staff login,
guest cookie and CSRF protections; no database credentials reach the browser.
Committed-change events contain no booking, contact or payment data. Clients
fetch their permitted view through the API; polling also reconciles changes
made through another backend instance.

This snapshot adapter suits the prototype. Before live launch, use scoped
database operations, verify cross-timezone staff behavior, complete customer
identity and payments, venue tenancy, HTTPS hosting, backups and monitoring.
Browser emulation does not replace physical-device acceptance.
