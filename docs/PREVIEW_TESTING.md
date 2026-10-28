# MENTORO Admin Workspace Preview

The dedicated branch deployment is available at:

`https://mentoro-platform-git-feat-admin-workspace-mvp-mustvfva17-3787.vercel.app`

Vercel has reported the deployment as `READY` for Git ref `feat/admin-workspace-mvp`. The two public browser variables below are configured on the Preview target for that branch. The owner confirmed that the in-app Supabase configuration warning is no longer visible.

## Preview-only environment variables

- `VITE_SUPABASE_URL` — URL for `mentoro-platform-test`.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — public publishable key for `mentoro-platform-test`.

These are scoped to Vercel Preview and `feat/admin-workspace-mvp`. Never use a Supabase secret or service-role key in a `VITE_` variable. Never copy credentials into this document or commit them to Git.

## One remaining Auth dashboard step

The connected Supabase tools available to this workflow can inspect the database but cannot update the project's Auth URL allow-list. To finish email-confirmation testing:

1. Open the [test Supabase project's Auth URL Configuration](https://supabase.com/dashboard/project/dkqrpndqfwmyevylbbse/auth/url-configuration).
2. Under **Redirect URLs**, add this exact URL:
   `https://mentoro-platform-git-feat-admin-workspace-mvp-mustvfva17-3787.vercel.app`
3. Also add this Preview-scoped wildcard for same-origin paths:
   `https://mentoro-platform-git-feat-admin-workspace-mvp-mustvfva17-3787.vercel.app/**`
4. Save. Leave Production site's URL configuration and environment variables unchanged.

The signup flow explicitly sets `emailRedirectTo: window.location.origin`, so the exact Preview origin must be allow-listed. Do not enable a broad wildcard covering every Vercel deployment and do not change the test project's Site URL unless a separate reviewed need requires it.

## Current functional boundaries

- Opening the deployed app and connecting its browser client to the test Supabase project are confirmed by the owner observing that the configuration warning disappeared.
- Sign-up/email confirmation still needs an end-to-end test using a dedicated test identity after the redirect URL is allow-listed.
- The test database has no published, assignable logbook template version. Offerings can be drafted, but publishable bookings require a clinically reviewed template first.
- A separate new Vercel project and direct deployment creation were denied by current Vercel connector permissions; this branch is deployed to the existing `mentoro-platform` project's branch alias. No Production deployment or database migration was performed for this Preview setup.

## Verification checklist

1. Check Vercel reports the source ref as `feat/admin-workspace-mvp`.
2. Confirm the two Vite variables remain scoped to Preview and the branch.
3. Confirm the warning remains gone.
4. After the redirect allow-list is saved, test signup/email confirmation and sign-in with a dedicated test user.
5. Verify trainee, mentor, and administrator access using separate test identities before testing privileged actions.
