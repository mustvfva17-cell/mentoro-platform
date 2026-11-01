# Central Specialty Logbook Foundation

**Status:** Initial repository scaffold only. No specialty ZIP has been imported,
no module is published, and no database or runtime provisioning workflow is changed.

## Confirmed product lifecycle

- An administrator provisions a specialty logbook for a trainee.
- The logbook becomes visible in the trainee account immediately after the
  provisioning transaction commits; a confirmed training enrollment is not a
  prerequisite for visibility.
- There is at most one persistent logbook per trainee and specialty.
- Repeated admin assignment is idempotent: return the existing logbook and
  preserve all entries, progress, reviews, and revisions.
- Additional bookings, mentors, or training periods in that specialty associate
  with the same logbook.
- A different specialty requires its own explicit admin provisioning.
- Mentor access remains restricted to the mentor's assigned training context;
  shared logbook ownership does not widen mentor visibility.

## Repository structure introduced

- `src/logbooks/`: shared registry, identity context, storage boundary, and
  provisioning policy.
- `src/specialties/<slug>/`: one module boundary per specialty.
- `docs/`: integration and lifecycle contracts.

## Module lifecycle

All six specialty IDs are registered for central administration. Their manifests
are currently `draft`, and templates/schemas are marked pending. This is
intentional: registry presence is not clinical approval and does not expose an
unfinished module to trainees.

## Not included in this scaffold

- No schema migration or Supabase project creation.
- No changes to existing enrollment, mentor, RLS, or entry-write behavior.
- No live admin UI or trainee workspace change.
- No imported ZIP assets, templates, or clinical content.
- No claim that the current production site now follows the new lifecycle.

## Next implementation gates

1. Audit the six ZIPs and map each source template, entry type, roadmap, and
   emergency/procedure catalogue to the shared module contract.
2. Design and test the fresh database model: canonical trainee-specialty logbook,
   enrollment association, entry provenance, and mentor-scoped review access.
3. Implement atomic admin provisioning and immediate trainee visibility through
   the trusted Vercel API and PostgreSQL transaction/RLS.
4. Port one module end-to-end, then migrate the remaining five using the same
   contract and regression suite.
