# Cardiology module integration

**Status:** Runtime module added to the central repository; database migration is proposed in this branch and has not been applied to a Supabase project. The template remains draft pending cardiologist review.

## Imported clinical source

The Cardiology V1 source archive was audited. The central module contains all 117 roadmap items and all five emergency templates, with their source labels, tiers, depth/frequency metadata, red flags, differentials, and investigation lists.

The standalone app's browser-only storage was not carried over as the source of truth. The Cardiology runtime uses the same authenticated HTML state bridge as the central General Surgery and Medical Oncology modules.

## Runtime contract

- Path: `/logbooks/cardiology/index.html`
- State sections: sessions, cases, procedures, roadmap, emergency, reflection.
- Each entry receives a unique stable ID, required by the trusted mentor review integrity RPC.
- Cloud state is scoped by the assigned logbook instance; local cache keys are namespaced by that instance.
- Mentor review is delivered through the platform's existing RPCs. The mentor view is read-only for trainee data, but permits authenticated review decisions.
- Trainees cannot self-mark an entry as mentor-verified.
- Export is blocked in read-only review mode and while cloud state is loading.

## Database allowlist migration

The proposed migration expands the fixed HTML asset allowlist for:
- template schema guard and admin publication;
- state load and save;
- mentor review load and review mutation.

It retains the latest existing function bodies, enrollment locking, revision conflict handling, per-item content digest integrity, authenticated actor checks, and existing mentor authorization. It does not create or publish a template.

## Clinical review gate

The source README explicitly says Tier / Depth / Frequency need review by a cardiologist and calls for patient consent and an appropriate chaperone for precordial examination and auscultation. The imported module is therefore registered as `draft`; it is not yet assignable to students.

## Not included

No Supabase project was created, no migration was applied, no Cardiology template version was published, and no admin/trainee workspace behavior is claimed to be complete by this module PR.
