# MENTORO Admin Workspace Preview

The dedicated branch deployment is available at:

`https://mentoro-platform-git-feat-admin-workspace-mvp-mustvfva17-3787.vercel.app`

Vercel has reported the deployment as `READY` for Git ref `feat/admin-workspace-mvp`. The two public browser variables below are configured on the Preview target for that branch. The owner confirmed that the in-app Supabase configuration warning is no longer visible.

## Preview-only environment variables

- `VITE_SUPABASE_URL` — URL for `mentoro-platform-test`.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — public publishable key for `mentoro-platform-test`.

These are scoped to Vercel Preview and `feat/admin-workspace-mvp`. Never use a Supabase secret or service-role key in a `VITE_` variable. Never copy credentials into this document or commit them to Git.

## Auth configuration status

The owner configured the test project's Site URL as `http://localhost:3000` and added both the exact Preview origin and its `/**` path pattern under **Redirect URLs**. The owner then completed signup, confirmed the email, signed in, and reached the trainee workspace; the browser also confirmed that a verification document was submitted. Keep the Production site's URL configuration and environment variables unchanged.

The app sets `emailRedirectTo: window.location.origin`, so the Preview origin must remain on the allow-list. Do not enable a broad wildcard covering every Vercel deployment. Vite's usual local development port is `5173`; add a localhost redirect only if local Auth testing is needed.


## Testing the admin review workflow safely

The test database currently has one active `TRAINEE` role and no `ADMIN` or `SUPER_ADMIN` role. The already-used trainee account must stay a trainee; do not elevate that account to admin.

1. In the Preview URL above, create a **second dedicated test account** using an email address you control. Confirm the email, then sign in once so MENTORO provisions its profile. Do not upload a verification document or submit a training application from this second account.
2. Open the **test** project SQL Editor only: [mentoro-platform-test SQL Editor](https://supabase.com/dashboard/project/dkqrpndqfwmyevylbbse/sql/new).
3. Execute the statement below, replacing the example address locally with the confirmed email for the dedicated test account. Do not send that email or the returned UUID in chat.

```sql
SELECT app_private.bootstrap_initial_super_admin('admin-test@example.com') AS admin_profile_id;
```

The migration intentionally provides no `public` RPC wrapper and revokes execution from `PUBLIC`, `anon`, `authenticated`, and `service_role`; it is callable only by a database owner/operator through the SQL Editor. It serializes concurrent attempts, refuses to run when an active platform administrator exists, requires exactly one confirmed identity with exactly one active trainee role, rejects accounts with verification/training activity, revokes that unused trainee role, grants the single `SUPER_ADMIN` role, and records an audit event. It does not create an open browser bootstrap path.

4. Return to the Preview and sign out of the trainee account. Sign in with the dedicated admin test account. It should route to **ADMIN WORKSPACE**.
5. Confirm the trainee account appears in the verification queue, open its private document, then approve or request a new document. Sign back into the trainee account to verify the resulting status. Use only test identities and the test database.

This step changes a role in the test database only when the operator explicitly runs the owner-only SQL statement. Do not run it in Production.

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
