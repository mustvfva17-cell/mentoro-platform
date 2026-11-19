# System review — stage 1

Baseline: `main` at `85d8d44`. This was a read-only review of the GitHub repository. Nothing was applied to Supabase or Vercel, and statements about remote environments are not verified here.

## Coverage

**Read in full:** `README.md`, `ARCHITECTURE.md`, `.github/workflows/validate.yml`, `package.json`, `api/**`, `supabase/functions/mentoro-license/index.ts`, the licensing foundation and single-device migrations, the core schema migration, `20261028062421_current_user_workflow_wrappers.sql`, `20261102100000_restore_enrollment_owned_logbooks.sql`, `20261104214000_register_ophthalmology_html_logbook.sql`, `src/main.js`, the licensing runtime, `public/logbooks/cardiology/app.js`, and several `scripts/check-*.mjs` and `supabase/tests/*.sql` files.

**Not read:** `src/admin-workspace.js`; the General Surgery, Medical Oncology and Pediatrics HTML runtimes; the Neurology, Anaesthesia and Ophthalmology `app.js`; roughly 55 other migrations; the live Supabase and Vercel state.

## What is solid

- Database as the authority: RLS on every table, column-level grants, `SECURITY DEFINER` functions with `search_path = ''`, two-layer wrappers (`public.*` invoker calling `app_private.*` definer functions that derive the actor from `auth.uid()`), row locks for capacity, request-id idempotency, and revision-checked state saves.
- Migrations that fail closed: the L-43 and single-device migrations run pre-checks before changing anything.
- License codes and device tokens are 160-bit random values stored as hashes, and the license tables are reachable only through `service_role`.
- Output escaping is consistent in `src/main.js` and in the Cardiology logbook. The `postMessage` bridge checks origin, source window and instance id.

## Findings

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Unsynced edits can be lost without a warning in the integrated logbooks. The logbook saves through `window.opener` and keeps showing its last "Saved" status when no acknowledgement arrives (for example after the dashboard tab is reloaded or suspended in the background). When the logbook is reopened, cloud state overwrites local edits. Because the logbooks are same-origin, the bridge adds no isolation. | `public/logbooks/cardiology/app.js`, `src/main.js`. Verified for Cardiology only. | **Open.** Needs per-logbook edits and browser tests. The seed migrations create DRAFT, non-assignable templates; whether any has been published since cannot be seen from the repository. |
| 2 | Migrations are not replayed on a clean database in CI. `supabase/tests/*.sql` need an existing database with an active administrator and trainee and are not run in CI. | `.github/workflows/validate.yml`, `supabase/tests/admin_register_mentor_authorization.sql` | **Open.** |
| 3 | The licensing runtime existed in three variants. The platform copies still told trainees that one license supports two devices while the database enforces one phone per license. | Blob SHAs differed between `public/logbooks/shared/`, `public/logbooks/anesthesia-icu/` and `vercel-logbooks/*/shared/` | **Fixed in the stage-1 pull request.** `scripts/check-logbook-copies-in-sync.mjs` now guards the runtime, the stylesheet, the mirrored content/style files and the header config. |
| 4 | The HTML-path allow-list is repeated in seven SQL functions and is patched per specialty (a 30 KB migration each, then string replacement over `pg_get_functiondef` for Ophthalmology). The current function bodies are not readable in one place. | `20261102100000_restore_enrollment_owned_logbooks.sql`, `20261104214000_register_ophthalmology_html_logbook.sql` | **Open.** A registry table plus one `is_registered_html_path()` function would remove the repetition. |
| 5 | No response security headers in the repository. | No `vercel.json` before the stage-1 pull request | **Baseline headers added.** No CSP: the logbook pages use inline scripts and styles, so roll out Report-Only first. No `Cross-Origin-Opener-Policy`: the logbook window bridge depends on `window.opener`. |
| 6 | No `supabase/config.toml`, so the Edge Function's `verify_jwt` setting (activation requests carry only the publishable key), Auth settings and Storage limits are not reproducible from the repository. | `supabase/` | **Open.** |
| 7 | A Supabase Development URL, a publishable key and a branch-preview hostname are hard-coded in `src/main.js` and `vercel-logbooks/general-surgery/api/license/config.mjs`. The key is public by design; the coupling and the stale branch name are the problem. | those two files | **Open — owner decision.** Prefer Vercel Preview environment variables. |
| 8 | Licensing is friction, not DRM. The installation id and device token live in the browser's IndexedDB; the clinical content is served as public static files; a device that stays offline keeps working until `valid_until` (seven days after its last successful validation). Local-first data has no server copy, and browsers may evict site storage (notably Safari after a period of inactivity — test on real devices). The runtime does not request persistent storage. | `public/logbooks/shared/license-runtime.js`, `supabase/functions/mentoro-license/index.ts` | **Documented — owner decision** on the mitigation (see below). |
| 9 | `admin_assign_trainee_enrollment_logbook` accepts any trainee whose account is not `SUSPENDED` (including `PENDING_VERIFICATION` and `REJECTED`), while `admin_confirm_application` requires `VERIFIED`. | `20261102100000_restore_enrollment_owned_logbooks.sql` | **Open — owner decision.** Document it if intentional, otherwise tighten it. |
| 10 | Documentation contradicted the code: L-42 vs L-43, six vs seven modules, Ajv and a Node write backend that are not built, 59 vs 70 migrations, stale commit pins. | `README.md`, `ARCHITECTURE.md` | **Fixed in the stage-1 pull request.** |
| 11 | Smaller items: `provision_current_trainee` calls a function that writes an audit row on every call, and the trainee workspace calls it on each page load (verify on the database); each open logbook polls enrollment status every 5 seconds; HTML-state validation checks shape and size only, so safety depends on escaping in every logbook (Cardiology verified); `esc(...).slice()` can cut an HTML entity because it truncates after escaping; many contract checks assert source text rather than behavior. | `src/main.js`, `20261028062421_current_user_workflow_wrappers.sql`, `public/logbooks/cardiology/app.js`, `scripts/check-*.mjs` | **Open.** |

## Owner decisions needed

- Hard-coded Development Supabase override (finding 7): remove it in favour of Preview environment variables, or keep it for an active pilot?
- Direct assignment (finding 9): should an administrator be able to assign a trainee who is not `VERIFIED`?
- Local-first data protection (finding 8): which mitigation — a persistent-storage request, backup reminders, an install-to-home-screen prompt, or an optional encrypted cloud backup?

## Suggested next steps

1. Fix finding 1 from a local clone with browser tests. The large single-file logbooks (General Surgery, Medical Oncology, Pediatrics) are impractical to edit through the GitHub API.
2. Add a clean-room replay job (Supabase CLI) and a fixture bootstrap so the SQL tests can run on a disposable database (finding 2).
3. Replace per-specialty allow-list patching with a registry (finding 4).
4. Run a read-only check of the authorized Supabase test project: security and performance advisors, the applied-migration ledger, and audit-log volume for finding 11.
