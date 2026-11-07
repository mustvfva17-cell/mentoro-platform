# ADR-03 — Licensed Standalone Logbooks with Local-First Storage

**Status:** Proposed implementation direction, approved in principle by the project owner on 2026-11-07.  
**Scope:** New trainee access and persistence model. Existing production flows remain unchanged until each migration step is reviewed and released.

## Context

The current platform centralizes trainee authentication, enrollment, logbook provisioning, and cloud persistence. This has created a disproportionate operational burden relative to the core product: the specialty logbooks.

The repository already contains direct static routes under `/logbooks/<specialty>/`. Several HTML logbooks also already persist a browser-local state snapshot, but their production launch path currently uses a parent-window bridge to load and save cloud state. A preview/local mode exists and is not equivalent to a licensed production experience.

The product owner wants each trainee to receive a direct specialty logbook URL, with access controlled by a centrally managed license and progress stored on the trainee's device.

## Decision direction

1. **Standalone specialty applications**
   - Each specialty remains a separately addressable route, for example `/logbooks/anesthesia-icu/`.
   - A logbook can open directly; it does not require the trainee to first sign in to a central student dashboard.
   - Specialty curriculum, forms, and validation remain within their own module. Shared code is limited to licensing, local persistence, backup/restore, and common UI utilities.

2. **Central license management**
   - An administrator issues a unique, high-entropy license for a trainee and a specific specialty/product.
   - License records are stored server-side. Store a one-way cryptographic hash of the license secret, not the plaintext secret.
   - License states include at least `ACTIVE`, `REVOKED`, and `EXPIRED`; the record includes the trainee/customer label, specialty/product, issue date, expiry (if applicable), and administrative notes.
   - License issuance, revocation, expiry changes, and device resets are administrative actions and must be auditable.
   - A shared URL alone must never grant access. The license must be activated through a trusted server endpoint.

3. **Device activation and revocation**
   - On first activation, the browser creates a random installation identifier and sends it with the license secret over HTTPS.
   - The trusted API validates the license, applies a configurable device limit, and returns a short-lived signed activation grant.
   - The browser stores only the opaque activation grant and installation identifier; it must not contain a Supabase service-role/secret key.
   - The logbook revalidates the grant periodically. Target policy: online validation at activation and at least once every 7 days, with a bounded offline grace period after a successful validation.
   - Revocation blocks new activations immediately and blocks an existing installation after its cached grant/grace period expires.
   - Device identifiers are best-effort browser installation identifiers, not hardware-bound identity. Clearing browser data, copying a browser profile, or modifying client code can bypass simplistic device limits; the system is an access-control deterrent, not DRM.
   - Exact device limit and offline grace duration remain configurable product settings to be finalized before production rollout.

4. **Local-first trainee data**
   - The trainee's logbook state is stored on that device in IndexedDB (preferred) or a well-defined local storage adapter.
   - Local state is namespaced by product/specialty and installation/license scope so different logbooks do not overwrite one another.
   - Routine editing does not require a network request. Network access is required for initial activation and periodic license checks.
   - Provide explicit JSON backup export and import/restore. Warn trainees that clearing browser data, changing browser profiles, or losing the device can destroy local-only progress.
   - Do not silently fall back to a shared preview storage namespace for licensed users.
   - Do not store patient-identifying information in logbook records.

5. **Administrator workflow**
   - Keep the existing authenticated admin identity and privileged admin workspace for license issuance and revocation in the first release.
   - Student-facing logbook routes do not require Supabase Auth once a valid license grant has been activated.
   - The admin UI should show license status, specialty, customer/trainee label, activation/device count, last validation, expiry, and revoke/reset actions.
   - Do not remove the existing enrollment, mentor-review, or cloud persistence infrastructure until its dependencies and any active records have been inventoried and a migration/retirement plan is approved.

## Security and implementation requirements

- License secrets are generated with a cryptographically secure random generator and shown to the administrator only at issuance time.
- Persist only a strong hash of the license secret. Compare hashes in a trusted backend using constant-time comparison where applicable.
- Apply rate limits and generic failure messages to activation/check endpoints; never reveal whether a particular license exists.
- Validate license state, specialty/product scope, expiry, device limit, and revocation on every server-side check.
- Signed activation grants must be integrity-protected, scoped to one license, specialty, and installation, and have bounded expiry. Signing secrets remain server-side.
- Admin-only license management must verify the authenticated actor and admin role server-side. Never trust client-supplied role labels or owner IDs.
- Supabase RLS, explicit grants, and database constraints remain required for license tables. No privileged key may be exposed to browser code.
- Local data is user-controlled and can be edited by the device owner. It must not be treated as a verified competency record, clinical sign-off, or tamper-proof audit trail.
- A watermark may display the trainee/customer label and license reference to discourage casual redistribution, but it is not an access-control boundary.
- Each specialty must retain its clinical-review gate. Technical licensing does not make a draft or clinically unreviewed logbook publishable.

## Migration plan

### Phase 0 — Inventory and contract
- Inventory each direct logbook route, current storage namespace, cloud bridge, export/print behavior, and clinical review status.
- Define the license data model, API contracts, admin workflow, device policy, and local backup/restore contract.
- Preserve the current production platform and data. No destructive migration or Auth shutdown.

### Phase 1 — Licensing foundation
- Implement license issuance, activation, periodic validation, revocation, rate limiting, and audit records in the development environment.
- Keep signing and database secrets server-side.
- Add tests for invalid, expired, revoked, wrong-specialty, over-device-limit, and offline-grace scenarios.

### Phase 2 — Standalone pilot
- Add a dedicated standalone licensed runtime mode to one technically suitable specialty module.
- Remove the requirement for a parent window only in that mode; retain the existing cloud bridge until the pilot is verified.
- Add IndexedDB persistence and tested JSON export/import.
- Do not distribute the pilot to trainees until the specialty's clinical content has passed its separate clinical review.

### Phase 3 — Admin and operational rollout
- Add license management to the authenticated admin workspace.
- Test license issuance and revocation end-to-end in development and a Vercel Preview.
- Confirm the actual production project, migrations, environment variables, backup, and rollback plan before any production change.

### Phase 4 — Specialty migration
- Migrate specialties one at a time, preserving the current route and a safe rollback path.
- Keep legacy student login/cloud workflows available during transition.
- Retire old trainee authentication/enrollment flows only after confirming there are no active users or records that depend on them and obtaining explicit approval.

## Consequences

**Benefits**
- Much simpler trainee experience: one direct link and one activation.
- Logbook editing works offline after activation.
- Less routine backend traffic and fewer student authentication failure points.
- Central ability to issue, revoke, and audit licenses.

**Trade-offs**
- Local-only data is not automatically synchronized across devices.
- The trainee is responsible for backups and device/browser continuity.
- Revocation is not instantaneous while a device is offline; it takes effect at the next successful validation or grant expiry.
- Client-side applications can be copied or modified by determined users; license checks deter casual sharing but cannot guarantee prevention.

## Explicit non-goals for the first release

- Cross-device synchronization.
- A full student dashboard, student account lifecycle, or mentor review workflow.
- DRM or a guarantee that source code cannot be copied.
- Destructive deletion of existing Supabase tables, users, enrollments, assignments, logbooks, or review history.
- Automatic clinical publication or approval of any specialty content.

## Open implementation choices

These must be finalized before the production pilot:
- Device limit per license (recommended starting point: configurable, initially 1 or 2).
- Offline grace period after last successful validation.
- Whether licenses are perpetual or have an explicit expiry by product.
- Which technically suitable, clinically reviewed specialty is the first trainee-facing pilot.
- Whether the existing Supabase project can host the license backend safely or a separate project is warranted.
