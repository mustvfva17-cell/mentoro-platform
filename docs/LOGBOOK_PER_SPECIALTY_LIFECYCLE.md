# Superseded: One Persistent Logbook per Trainee per Specialty

**Historical decision:** L-42  
**Status:** Superseded on 2026-11-02 by L-43 after explicit project-owner confirmation.  
**Do not implement this document as the current product model.**

L-42 proposed one persistent logbook per trainee-specialty pair. The project owner has now explicitly selected the opposite model: each distinct training enrollment owns its own independent logbook, including repeat enrollments in the same specialty. This file is retained only to preserve the history of the superseded proposal.

See [the current per-enrollment lifecycle contract](LOGBOOK_PER_ENROLLMENT_LIFECYCLE.md) and [the decision register](decisions/MENTORO_DECISIONS_REGISTER.md#l-43--independent-logbook-per-training-enrollment).

No database migration or runtime change is authorized by this supersession note. The current live schema and migration ledger still need to be inspected in the intended non-production Supabase project before any migration work.
