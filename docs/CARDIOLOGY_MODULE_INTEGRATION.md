# Cardiology module integration

**Status:** Runtime module and Admin preview registration are added to the central repository. This branch proposes two database migrations (the trusted HTML allowlist and a non-assignable template draft); neither has been applied to a Supabase project. The template remains draft pending cardiologist review.

## Imported clinical source

The Cardiology V1 source archive was audited. The central runtime preserves all 117 roadmap entries and all five emergency templates, including source labels, tiers, depth/frequency metadata, red flags, differentials, and investigation lists.

The UI was rebuilt as a central MENTORO runtime rather than copying the standalone Vite shell, so it can use the shared platform bridge and security boundary. The standalone app's browser-only storage was not carried over as the source of truth.

## Runtime contract

- Path: `/logbooks/cardiology/index.html`
- State sections: sessions, cases, procedures, roadmap, emergency, reflection.
- Each saved item receives a stable unique ID, required by the trusted mentor review integrity RPC.
- Cloud state is scoped by the assigned logbook instance; any local cache is namespaced by instance and specialty.
- Mentor review uses the platform's existing RPCs. The mentor view is read-only for trainee data, but permits authenticated review decisions.
- Trainees cannot self-mark an entry as mentor-verified.
- JSON backup export is blocked in read-only review mode and while cloud state is loading.
- If a first cloud save was interrupted, an instance-scoped trainee cache is preserved and reconciled on the first load with no server state. Mentor read-only views never display browser-local trainee cache.

## Database migrations

The proposed trusted allowlist migration extends the existing fixed HTML asset checks for:
- template schema guard and admin publication;
- state load and save;
- mentor review load and review mutation.

It retains the latest existing function bodies, enrollment locking, revision conflict handling, per-item content digest integrity, authenticated actor checks, and mentor authorization.

A second migration idempotently seeds a Cardiology HTML template/version in `DRAFT`, `is_assignable = false`, bound to the Cardiology specialty row. This makes it visible in the Admin template review queue; only the normal Admin publication RPC can make it assignable after clinical review.

## Admin and trainee lifecycle

The Admin workspace's existing-HTML preview list and registered-HTML assignment filter now derive from the central module registry. Cardiology appears as a Draft preview and remains excluded from assignable templates until the draft is reviewed and explicitly published. This does not add a trainee template picker or allow self-provisioning.

The trainee account does not see this module until an administrator provisions an eligible published Cardiology version through the platform's approved workflow. The existing database lifecycle still needs its separate one-logbook-per-trainee-specialty redesign before immediate admin provisioning is available end-to-end.

## Source features not yet ported

The current runtime includes overview, roadmap filtering/status, sessions, cases, procedures, teaching discussions, emergency prompts, reflection, JSON backup, and mentor review. It is not a pixel-identical port of the standalone V1 UI; detailed source interactions and visual polish still need a side-by-side pass before the module is considered feature-complete.

## Clinical review gate

The source README explicitly says Tier / Depth / Frequency need review by a cardiologist and calls for patient consent and an appropriate chaperone for precordial examination and auscultation. The imported module is therefore registered as `draft`; it is not yet assignable to students.

Clinical review must also verify the five emergency learning prompts and their investigation lists. Technical import does not constitute approval of clinical content or a treatment protocol.

## Not included

No Supabase project was created, no migration was applied, no Cardiology template version was published, and no trainee provisioning/runtime access is claimed to be complete by this module PR.
