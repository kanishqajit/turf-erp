# Release workflow

The user requires production releases through Git. Commit the requested changes
and push to `codex/free-cloudflare-supabase-prototype`; GitHub Actions applies
database migrations, deploys Supabase functions and deploys Cloudflare Pages.
`FUTLY_DATABASE_MIGRATIONS_ENABLED=true` enables the database step using the
Futly-scoped CI token. Keep this gate enabled for database-dependent releases;
if it is disabled, handle the migration explicitly with the user first.
Wait for the deployment workflow and its live commit checks before reporting
that the release is complete.

Do not bypass this workflow with direct Cloudflare/Supabase deployments or
production SQL changes unless the user explicitly requests an exception.
Keep unrelated working-tree edits out of release commits. Never commit secrets,
local databases, generated runtime/build output, or verification artifacts.

See `FREE-HOSTING.md` and `.github/workflows/prototype-deploy.yml` for the release
branch, build steps, migration rules, and verification.
