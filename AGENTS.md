# Release workflow

The user requires production releases through Git. Commit the requested changes
and push to `codex/free-cloudflare-supabase-prototype`; GitHub Actions applies
database migrations, deploys Supabase functions and deploys Cloudflare Pages.
Wait for the deployment workflow and its live commit checks before reporting
that the release is complete.

Do not bypass this workflow with direct Cloudflare/Supabase deployments or
production SQL changes unless the user explicitly requests an exception.
Keep unrelated working-tree edits out of release commits. Never commit secrets,
local databases, generated runtime/build output, or verification artifacts.

See `FREE-HOSTING.md` and `.github/workflows/prototype-deploy.yml` for the release
branch, build steps, migration rules, and verification.
