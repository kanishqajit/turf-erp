# Free hosted prototype

Cloudflare Pages serves desktop `/`, staff `/m`, and customer `/book/` at
https://futly-prototype.pages.dev. The same-origin `/api/*` proxy calls the
`futly-api` Supabase Edge Function; PostgreSQL is the durable ledger.

## Architecture

The customer app renders venues independently of guest-session creation and
booking history. Availability loads after the venue list; repeated requests for
the same venue/day share one in-flight request. Booking mutations still wait for
a valid guest session and CSRF token.

`GET /api/public/venues` uses the separate `futly-venues` Edge Function. It reads
only `deposit_amount` through the backend-only `futly_public_venue_settings` RPC
and shares public venue metadata with the main API. This entrypoint imports no
SQLite engine or full-ledger workspace. Other routes retain `futly-api` and the
existing ledger rules. Deploy both functions after `build:edge`.

The 25 October 2026 release applied the SQL in
`supabase/migrations/20261025110933_fast_public_venues.sql` through the connected
SQL tool. The Git migration runner reapplies that idempotent function definition
and records its migration in the same transaction. No existing tables or data
are changed by this migration.
The RPC denies `anon` and `authenticated` execution and retains trusted-backend
token validation. Fresh live endpoint samples were 963, 723 and 676 ms. A first
browser navigation showed its turf card after roughly 3 seconds including page
startup; session/history continued independently. These are desktop-browser and
HTTP measurements, not physical-phone acceptance results.

This release passed 55 regression tests and all 10 hosted workflow checks,
including synthetic unpaid confirmation, staff visibility and cancellation.
Production deployment: `ee44a20f-049c-44cf-a1e3-97cfd44f3bf8`.

The API shares the local Node server's domain rules and HTTP routes. Supabase's
hosted runtime does not implement `node:sqlite`, so its request-scoped in-memory
workspace uses pinned sql.js 1.13.0. Hosted mode persists no SQLite file. Existing
staff passwords, roles, guest ownership, CSRF, conflict checks, revision retries,
clocks, receipts and audit events remain in use.

Only the trusted Cloudflare proxy supplies the integration token. Supabase
verifies it through the private ledger before serving an application route.
The token is an encrypted Cloudflare binding, never browser code. Database
rate-limit counters protect logins and mutations across function instances.
Private tables deny browser database roles. Security advisors report no warnings
or errors; RLS-without-policy information is expected for those private tables.

All three browser frontends retain periodic refresh. Hosted events return 204
to stop EventSource reconnects: serverless instances do not share an in-process
SSE broadcast. Screen updates therefore follow polling.

## Build and verification

```sh
npm ci
npm run check
npm run check:portable
npm run build:edge
npm run build:pages
```

`build:pages` packages an explicit public-file allowlist into `dist/`, compiles
the API proxy, and extracts the module from Wrangler's multipart output into a
plain `_worker.js` for Pages advanced mode. It excludes environment files,
databases, server sources, test credentials and verification artifacts.
The customer frontend under `customer/` is a snapshot of the integrated sibling
Turf-app checkout; reconcile future customer changes here before deployment.

47 local regression tests passed. The portable engine passed 46 applicable
tests; the omitted test covers local disk persistence. Hosted checks through the
public Cloudflare URL passed operator login, guest/staff restrictions, customer
booking, conflicts, idempotent confirmation, guest isolation, staff visibility,
cancellation reopening availability and logout. Synthetic unpaid verification
bookings are labelled Edge Verification FC and cancelled afterward.

Public browser verification also passed operator sign-in and customer booking
confirmation/cancellation (Browser Verification FC). The staff phone console
loaded the shared ledger at 390px without horizontal overflow. Screenshots are
saved locally under `artifacts/hosting/` and excluded from deployment.

Run the hosted API check with ignored private configuration:

```sh
TEST_PUBLIC_ORIGIN=https://futly-prototype.pages.dev \
node --env-file=.env.supabase.local --env-file=.env.supabase-test.local scripts/verify-edge.mjs
```

## GitHub pipeline

Production releases start with a commit and push to
`codex/free-cloudflare-supabase-prototype` in `kanishqajit/turf-erp`:

```sh
git push origin codex/free-cloudflare-supabase-prototype
```

`prototype-check.yml` verifies pull requests and pushes. `prototype-deploy.yml`
runs automatically on production-branch pushes with `FUTLY_DEPLOY_ENABLED=true`
and `FUTLY_DATABASE_MIGRATIONS_ENABLED=true`:

1. Install the locked dependencies and run syntax, regression and portable tests.
2. Build the shared Edge runtime with the pushed commit SHA.
3. Apply pending SQL files from `supabase/migrations/` using the Supabase
   Management API and the existing CI token. Schema changes and migration history
   are committed together under a database advisory lock. Applied SQL must match
   Git exactly; missing or edited historical migrations stop deployment.
4. Deploy `futly-api` and `futly-venues` to Supabase.
5. Build and deploy the tracked frontend assets and API proxy to Cloudflare Pages.
6. Verify `/release.json`, the customer JavaScript, and both backend functions
   match the pushed SHA. A release is complete only when these checks pass.

The encrypted GitHub secrets are `SUPABASE_ACCESS_TOKEN` (Futly database read/write,
Edge Functions read/write, and Project Settings read) and `CLOUDFLARE_API_TOKEN`
(Pages write access). The Supabase token is restricted to the Futly project.
The existing `prototype` GitHub environment is used. CI logs identify the release
commit and failed step; no database password is needed by this pipeline.

The CI token was replaced on 25 October 2026 to enable SQL migrations. The token
was configured with a 30-day expiry; rotate the GitHub secret before expiry.
Both deployment variables must remain enabled for the complete release flow.

Historical migration filenames now use the versions already recorded remotely.
Their complete SQL contents were compared with the stored migration statements
before renaming; no historical SQL was changed. New migrations should be created
with `supabase migration new`, tested, committed, and released through the same
push workflow. Transactional migrations are required by the migration runner.

Cloudflare production bindings contain `TURF_SUPABASE_URL` and encrypted
`TURF_SUPABASE_SERVER_TOKEN`. Preview environments do not receive the live token.
The public backend URL is retained in `wrangler.jsonc`.

Direct deployment commands, connector uploads and direct production SQL are not
the normal release path. Make changes in Git and wait for the deployment workflow
and its live checks. The manual workflow trigger is available for a retry of a
committed revision.

## Prototype limits

Free-plan quotas and Supabase inactivity pauses apply. Customer history belongs
to a browser cookie. Payment records do not charge a payment gateway. This is
one demo venue. Full-ledger snapshots suit the prototype; replace them with
scoped PostgreSQL transactions before scaling to busy venues. Physical-phone
acceptance and production backup/monitoring remain launch work.
