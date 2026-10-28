# MENTORO Preview Environment Checklist

This checklist is for a Vercel team owner who can authorize a new project or connect a repository. The GitHub/Vercel integration available during the current audit could not access a project linked to this repository, so this work has not been deployed to a Preview environment.

## Verified Vercel status

- Team: `mustvfva17-3787`, plan reported as `Hobby`.
- Vercel's Git deployment context currently reports no linked Git projects for this team.
- The existing `mentoro` project has a deployment whose target is `production`; it was not modified and must not be reused as the platform Preview.
- A repository-linked Preview could not be provisioned with the current access. A team owner needs to authorize the GitHub connection and confirm that Preview builds use the test Supabase project only.

## 1. Create an isolated Preview project

- Create a **new** Vercel project, for example `mentoro-platform-preview`.
- Connect it to GitHub repository `mustvfva17-cell/mentoro-platform`.
- Use the Vite frontend configuration from the repository; the production build command is `npm run build` and the build output directory is `dist`.
- Keep Production deployments disabled or restricted until the reviewed release plan is approved. Do not repurpose the existing `mentoro` project, whose latest deployment is marked as a Production target.
- Confirm that a push to `feat/trainee-auth-foundation` creates a Preview deployment rather than changing the production site.

## 2. Configure Preview-only Supabase variables

Set the following variables for the **Preview** environment only, using values from the test project `mentoro-platform-test`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Do not copy production values into Preview. Do not add a Supabase secret/service-role key to any `VITE_*` variable: Vite exposes those values to browser code.

## 3. Configure Auth redirects

- Add the independently verified Preview URL to the test Supabase project's Auth URL configuration / redirect allowlist.
- Prefer an explicit stable Preview/staging domain where possible. Do not broaden the allowlist unnecessarily.
- Confirm email signup can redirect back to the deployed Preview domain and that sign-in works after email confirmation.

## 4. End-to-end acceptance checks

Use only synthetic test accounts and data. Do not enter patient-identifying information.

1. New trainee signup and email confirmation.
2. Existing ADMIN-only or MENTOR-only account cannot enter the trainee workspace or self-provision a TRAINEE role.
3. Trainee university-ID upload is private and restricted to JPEG, PNG, or PDF up to 8 MiB.
4. An unverified trainee cannot apply; a verified trainee can apply to a published offering with a matching open future slot.
5. Only the assigned mentor can review the application; only an active administrator can confirm it.
6. Confirmation creates exactly one enrollment and one independent logbook instance for that application.
7. Trainee can save a draft and submit it; the database generates the submission timestamp.
8. Only the assigned mentor can review a submitted entry.
9. A second training booking creates a separate logbook and does not copy entries from the earlier training.
10. Verify mobile layout and sign-out/sign-in, then capture the Preview URL and CI run links in the release notes.

## Current blockers and safety

- Preview project creation/linkage requires Vercel owner authorization; no project was created during this audit.
- The repository currently has no committed npm lockfile, so dependency installation is not yet fully reproducible.
- Clean-room migration replay and real browser/e2e tests are still outstanding.
- Neither stacked PR is production-approved. Do not merge PR #1 without its required database migration/release sequence from PR #2.
