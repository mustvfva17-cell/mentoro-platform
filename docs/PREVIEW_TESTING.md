# MENTORO Admin Workspace Preview

The dedicated branch deployment is available at:

`https://mentoro-platform-git-feat-admin-workspace-mvp-mustvfva17-3787.vercel.app`

Vercel has reported the admin deployment as `READY` for Git ref `feat/admin-workspace-mvp`. The owner confirmed that its in-app Supabase configuration warning disappeared after the two public browser variables were configured for that branch.

The template-schema branch has a Ready Vercel deployment at the stable branch alias:

`https://mentoro-platform-git-feat-logbook-templa-2a615c-mustvfva17-3787.vercel.app`

The latest previously verified runtime deployment was `READY` for commit `9f7bf23670e0558bb2201d4d792f65e5c6861c9f` on `feat/logbook-template-drafts`; it includes both registered HTML assets (Medical Oncology and General Surgery), trainee launch wiring, and read-only mentor launch wiring. The latest copy update is commit `9b400ccf87e6040c811559dca3b57eb4be7cca85`, and GitHub Actions Run #559 passed. A READY deployment for this newest commit has not yet been independently verified. The two browser variables remain scoped to this branch and Preview target only. Vercel deployment protection blocks automated page inspection, so the owner still needs to open the Preview manually for rendered-UI and cloud-sync checks.

## Preview-only environment variables

- `VITE_SUPABASE_URL` — `https://dkqrpndqfwmyevylbbse.supabase.co`.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — the public publishable key for `mentoro-platform-test`.

Both variables are now configured in Vercel with target `Preview` and Git Branch `feat/logbook-template-drafts`; they point to `mentoro-platform-test`. Do not change Production or expose a Supabase secret/service-role key in a `VITE_` variable. Never copy credentials into this document or commit them to Git.

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

## Database-boundary payload validation

Every insert or payload/instance update on `public.logbook_entries` is validated by a private trigger against the immutable schema definition attached to that logbook instance. It rejects unknown field keys, missing required values, wrong types, invalid ISO dates/select options, numeric values outside configured bounds, and payloads larger than 64 KiB. A rollback-only test using a synthetic template, enrollment, and logbook instance accepted a valid payload and rejected the invalid cases, then confirmed all fixture rows were rolled back. The repeatable test is checked into `supabase/tests/logbook_entry_payload_validation.sql`; run it only in the test/disposable database via SQL Editor. It starts a transaction and ends in `ROLLBACK`.

## Existing HTML logbook cloud-state integration

- The original `/logbooks/medical-oncology/index.html` is retained, and the existing General Surgery HTML UI is added at `/logbooks/general-surgery/index.html`.
- An enrollment-linked launch uses `?instance={uuid}` and reads/saves the full existing HTML state with `get_my_logbook_html_state` and `save_my_logbook_html_state`.
- The bridge uses same-origin `postMessage` with source/origin checks. Cloud writes are revision-checked, limited to the active assigned trainee, and rejected for archived/cancelled/revoked enrollments or unregistered HTML assets.
- Mentors assigned to an HTML-backed enrollment can open the existing UI in read-only mode. It loads state from the same access-scoped RPC; the child page disables data-editing controls and the parent refuses write messages in read-only mode. The rollback-only integration test confirms an assigned mentor can read but cannot save the trainee’s state.
- `?mode=preview` remains local-only for design inspection. It is not a confirmed training record.
- Item-level mentor decisions for legacy HTML sessions/cases are now supported through the `logbook_html_item_reviews` audit trail and the `mentor_review_html_logbook_item` / `get_my_logbook_html_item_reviews` RPCs. The complete HTML logbook content remains one revisioned JSON state record, separate from native `logbook_entries`; mentor decisions are stored separately and scoped to the training instance.
- Both `medical-oncology-html` and `general-surgery-html` remain `DRAFT`, `is_assignable=false`. Neither has been published. An authorized clinical reviewer must assess each template before publication.
## Current functional boundaries

- Opening the deployed app and connecting its browser client to the test Supabase project are confirmed by the owner observing that the configuration warning disappeared.
- Trainee sign-up, email confirmation, sign-in, private document upload, and the admin queue have been manually smoke-tested by the owner. The approve/reject state transition still needs to be completed and verified from both roles.
- The test database has no published, assignable logbook template version. The branch now provides schema-driven trainee forms, draft creation, immutable version creation, an admin review queue, and an audited publication RPC. No template has been published or made assignable; clinical review must be completed before using the publish action.
- A separate new Vercel project and direct deployment creation were denied by current Vercel connector permissions; this branch is deployed to the existing `mentoro-platform` project's branch alias. No Production deployment or database migration was performed for this Preview setup.

## Verification checklist

1. Check Vercel reports the source ref as `feat/logbook-template-drafts` and the deployment commit includes the General Surgery HTML import.
2. Confirm the two Vite variables remain scoped to Preview and the branch.
3. Confirm the warning remains gone.
4. After branch-scoped Preview variables and the Auth redirect allow-list are set, test signup/email confirmation and sign-in with a dedicated test user.
5. Verify trainee, mentor, and administrator access using separate test identities before testing privileged actions.
