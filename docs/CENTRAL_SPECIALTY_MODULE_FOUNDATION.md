# Central Specialty Logbook Foundation

**Status:** Six specialty IDs are centrally registered. The Anesthesia & Critical Care HTML runtime is being added on a Draft branch alongside the five existing HTML runtimes. Clinical modules remain non-assignable until specialty review and authorized publication. The proposed Anesthesia migrations have not been applied to Supabase.

## Confirmed product lifecycle

- An administrator provisions a specialty logbook for a trainee.
- The logbook becomes visible in the trainee account immediately after the provisioning transaction commits; a confirmed training enrollment is not a prerequisite for visibility.
- There is at most one persistent logbook per trainee and specialty.
- Repeated admin assignment is idempotent: return the existing logbook and preserve all entries, progress, reviews, and revisions.
- Additional bookings, mentors, or training periods in that specialty associate with the same logbook.
- A different specialty requires its own explicit admin provisioning.
- Mentor access remains restricted to the mentor's assigned training context; shared logbook ownership does not widen mentor visibility.

## Repository structure

- `src/logbooks/`: shared registry, identity context, storage boundary, and provisioning policy.
- `src/specialties/<slug>/`: one module boundary per specialty.
- `public/logbooks/<slug>/index.html`: existing HTML logbook runtime pages, where present.
- `docs/`: integration and lifecycle contracts.

## General Surgery import audit

The uploaded `mentoro-general-surgery-logbook-project-v3.zip` was inspected. It contains a standalone Vite app with a template, roadmap data, clinical forms, emergency templates, styling, and browser-local persistence. Its `src/app.js` does not contain the MENTORO HTML postMessage bridge.

The central repository already contains `public/logbooks/general-surgery/index.html`. That file has the parent-window handshake and state/review messages used by the current platform, including load-state, save-state, read-only, and mentor-review flows. It is the safer current runtime source; replacing it with the standalone ZIP would remove the bridge and regress cloud persistence/review behavior.

Therefore this integration registers the existing central General Surgery runtime in the single module registry and makes the main application's HTML renderer allowlist derive from that registry. The standalone ZIP is retained as audited source material for a later feature/content comparison, not copied over the integrated runtime.

## Module lifecycle

The module registry contains six specialty IDs. General Surgery and Medical Oncology declare their existing HTML runtime paths. Their catalogue lifecycle remains `draft` pending the clinical/schema review gate; runtime registration is not the same thing as clinical approval or permission for trainees to self-select a template.

Cardiology, Neurology, and Pediatrics have central HTML runtime pages. Anesthesia & Critical Care is now merged into the central HTML runtime on `main`, with 157 source roadmap items, 17 groups, nine Patient Journey prompts, five Clinical Interpretation prompts, and five emergency templates. Its clinical catalogue remains Draft pending anesthesiologist / intensivist review. Runtime registration and CI validation do not mean clinical approval or assignment eligibility.

## Not included

- No live Supabase migration execution or Supabase project creation is claimed by this integration.
- No change to current enrollment, mentor, RLS, or entry-write behavior.
- No new admin UI or trainee provisioning UI.
- No blanket import of standalone ZIPs.
- No claim that all six specialties are operational.

## Next implementation gates

1. Compare the uploaded General Surgery ZIP against the central integrated runtime and port only missing, verified UI/content improvements without losing bridge behavior.
2. Design and test the fresh database model: canonical trainee-specialty logbook, enrollment association, entry provenance, and mentor-scoped review access.
3. Implement atomic admin provisioning and immediate trainee visibility through the trusted Vercel API and PostgreSQL transaction/RLS.
4. Keep all six template versions Draft/non-assignable until their specialty review is documented; validate the integrated runtimes through an authorized Preview environment before publication.
