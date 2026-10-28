# MENTORO Admin Workspace Preview

This branch is intended to be tested in a Vercel Preview deployment, not in Production.

## Required Preview-only environment variables

Configure these variables for the Vercel Preview target and the `feat/admin-workspace-mvp` Git branch only:

- `VITE_SUPABASE_URL` — URL of `mentoro-platform-test`.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — public publishable key for `mentoro-platform-test`.

Do not use a Supabase secret key or service-role key in a `VITE_` variable. Never copy any credentials into this document or commit them to Git.

## Authentication

Before testing sign-up and email confirmation, configure the test project's Supabase Auth URL configuration to allow the actual Preview hostname. Do not add a wildcard redirect or change the Production site's redirect configuration as a shortcut.

## Current blockers

- The Vercel project owner connection currently allows project/deployment reads, but creation of a separate Vercel project and direct deployment creation were denied by Vercel permissions.
- A Preview deployment from `feat/admin-workspace-mvp` must be observed and its exact URL confirmed before it is shared.
- The test database has no published, assignable logbook template version. Offerings can be drafted, but publishable bookings require a clinically reviewed template.
- No Production deployment or database migration should be performed as part of this Preview setup.

## Verification checklist

1. Confirm Vercel reports the deployment environment as Preview and the Git source as `feat/admin-workspace-mvp`.
2. Confirm the two Vite variables are scoped to Preview and the branch.
3. Open the deployment and verify that the Supabase configuration warning is gone.
4. Test sign-in and sign-up using a dedicated test identity only.
5. Verify access controls from separate trainee, mentor, and administrator identities before testing privileged actions.
