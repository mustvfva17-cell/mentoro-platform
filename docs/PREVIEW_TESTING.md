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


## Admin review test status

The test database now has a dedicated initial `SUPER_ADMIN` identity created through the owner-only bootstrap function. The bootstrap is a one-time operation and refuses to proceed after an active platform administrator exists; **do not run the bootstrap command again**. Do not promote the existing trainee account or change its status directly in SQL.

The owner has already signed in to the admin Preview and confirmed that the dashboard lists the pending trainee verification, provides a five-minute signed document link, and shows approve/request-new-document actions.

Next manual test, using only the test project:

1. Sign in to the existing dedicated admin test identity in the Preview.
2. Open the trainee’s private document and check that it opens only from the signed link.
3. After reviewing the document, choose the appropriate review decision in the admin UI.
4. Sign in as the trainee and confirm the displayed account status reflects the database decision.
5. If an operation fails, capture the visible error without sharing passwords, signed URLs, or secret keys.

Do not mark a trainee verified until the submitted document has actually been reviewed. Production roles and data must remain unchanged.

## Current functional boundaries

- Opening the deployed app and connecting its browser client to the test Supabase project are confirmed by the owner observing that the configuration warning disappeared.
- Trainee sign-up, email confirmation, sign-in, private document upload, and the admin queue have been manually smoke-tested by the owner. The approve/reject state transition still needs to be completed and verified from both roles.
- The test database has no published, assignable logbook template version. The new branch adds a schema-driven trainee form and draft-template review queue, but no template can be activated or booked until clinical review/publication is designed and verified.
- A separate new Vercel project and direct deployment creation were denied by current Vercel connector permissions; this branch is deployed to the existing `mentoro-platform` project's branch alias. No Production deployment or database migration was performed for this Preview setup.

## Verification checklist

1. Check Vercel reports the source ref as `feat/admin-workspace-mvp`.
2. Confirm the two Vite variables remain scoped to Preview and the branch.
3. Confirm the warning remains gone.
4. After the redirect allow-list is saved, test signup/email confirmation and sign-in with a dedicated test user.
5. Verify trainee, mentor, and administrator access using separate test identities before testing privileged actions.
