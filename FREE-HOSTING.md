# Free hosted prototype

Cloudflare Pages serves desktop `/`, staff `/m`, and customer `/book/` at
https://futly-prototype.pages.dev. The same-origin `/api/*` proxy calls the
`futly-api` Supabase Edge Function; PostgreSQL is the durable ledger.

## Architecture

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

`prototype-check.yml` runs syntax/regression and portable-engine checks and builds
the deployment. `prototype-deploy.yml` deploys the backend first, then the
frontend, from `codex/free-cloudflare-supabase-prototype`. Automatic deployment
is enabled with `FUTLY_DEPLOY_ENABLED=true` and these encrypted repository secrets:

The first pushed branch passed GitHub's Prototype checks workflow. The deploy
workflow correctly skipped while its credential guard was disabled.

* `SUPABASE_ACCESS_TOKEN`: deployment access for the Futly project.
* `CLOUDFLARE_API_TOKEN`: Pages deployment permission for the Cloudflare account.

The Supabase token is scoped to Futly, with Edge Functions read-write and project
settings read, and expires 90 days after creation on 13 October 2026. Rotate it
in GitHub before expiry to keep deployments working. The Cloudflare token grants
only Pages edit on the hosting account and currently has no expiry.

Cloudflare production bindings contain `TURF_SUPABASE_URL` and encrypted
`TURF_SUPABASE_SERVER_TOKEN`. Preview environments do not receive the live token.
The workflow uses the provisioned database and does not automatically reapply
schema migrations. Current remote migration history is:

| Remote version | Local source |
| --- | --- |
| 20261009110515 | 20261008140531_futly_shared_ledger.sql |
| 20261009110643 | 20261009110622_restrict_auto_rls_function.sql |
| 20261013125005 | 20261013124920_edge_api_rate_limits.sql |

Reconcile these imported version identifiers before enabling automatic schema
deployment. Apply future schema changes separately and verify them before
publishing a dependent API version.

## Prototype limits

Free-plan quotas and Supabase inactivity pauses apply. Customer history belongs
to a browser cookie. Payment records do not charge a payment gateway. This is
one demo venue. Full-ledger snapshots suit the prototype; replace them with
scoped PostgreSQL transactions before scaling to busy venues. Physical-phone
acceptance and production backup/monitoring remain launch work.
