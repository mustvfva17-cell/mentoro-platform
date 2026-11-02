# Pediatrics HTML Logbook Integration

## Status

Pediatrics is registered as a central MENTORO HTML specialty module. The runtime is a single self-contained asset at `/logbooks/pediatrics/index.html`; it uses the platform's authenticated parent-window state bridge and existing mentor-review RPCs.

Pediatrics remains a clinical-review draft: the module manifest is `lifecycle: draft`, and the proposed database seed creates an inactive `DRAFT` template with `is_assignable = false`.

## Imported source catalogue

Source archive: `mentoro-pediatrics-logbook-project-v1.1.zip`.

- 137 roadmap rows preserving the source item, Tier, Depth, and Frequency fields.
- Source Tier distribution: 63 Core, 51 Expanded, and 23 Advanced.
- 14 roadmap groups with runtime and contract checks that every source row is covered exactly once, without gaps or overlaps.
- Nine Pediatric Patient Journey prompts.
- Five Clinical Interpretation prompts.
- Five emergency templates, preserving their red flags, differential diagnoses, and investigations.

## Platform integration

- Registered through `src/logbooks/module-registry.js`; the central Admin HTML preview and assignment filters derive from the module registry.
- One self-contained HTML asset contains the UI, CSS, clinical catalogue, and runtime. It has no adjacent specialty file dependencies.
- Browser cache is scoped by logbook instance and specialty; the source standalone application's prior local storage namespaces are not imported.
- State is synchronized through the existing `get_my_logbook_html_state` / `save_my_logbook_html_state` parent bridge.
- Stable entry IDs support the existing item-digest mentor-review RPCs.
- Mentor review is read-only for trainee data; mentor decisions are submitted through the central parent application.
- JSON backup export is blocked before the cloud state has loaded and in read-only mentor-review views.
- Legacy `mentorVerified` and `mentorDate` fields are stripped from imported state; the trainee UI has no self-verification control.

## Pediatric safeguarding gates

The source README states that examining children requires guardian consent and that genital / pubertal examination is Observed-only by design.

The central runtime:
- Requires the trainee to select a guardian-consent status for clinical session, case, procedure, quick-exposure, and emergency entries.
- Rejects a recorded genital / pubertal / intimate examination unless the consent status is `Confirmed` and the trainee's role is `Observed`.
- Applies the same safeguard to roadmap completion, detailed forms, emergency forms, and quick-exposure entries.
- Stores the trainee-declared consent status and observed role in a governance record that is synchronized with the logbook state.

**Important limitation:** this is a trainee attestation field, not independent evidence that lawful guardian consent was obtained. MENTORO does not verify a legal consent document or substitute for institutional consent procedures. Clinical reviewers must approve the final workflow and wording.

## Proposed database updates

Two migrations are included:
1. `20261102060000_register_pediatrics_html_logbook.sql` adds the Pediatrics path to the six trusted HTML renderer / state / mentor-review functions. It carries forward the latest direct-admin-aware state load/save implementations and the existing publication/versioning and review-integrity rules.
2. `20261102070000_seed_pediatrics_html_logbook_draft.sql` idempotently seeds `pediatrics-html` for the Pediatrics specialty as inactive, `DRAFT`, and non-assignable. It verifies the slug belongs to Pediatrics and records the clinical-review gate.

No Supabase migration has been applied by this integration. PostgreSQL execution and RLS / RPC verification on a staging database remain required.

## Clinical review gate

Before assignment, an authorized pediatrician / clinical reviewer must review the Tier / Depth / Frequency classifications, emergency prompts, consent language, and Observed-only handling. An authorized administrator must then record the required review and publish the template. Until those steps are complete, Pediatrics remains non-assignable.

## Not included

- The broader one-persistent-logbook-per-trainee-specialty schema redesign and enrollment association rollout.
- Live or staging Supabase migration execution.
- Clinical approval or publication of Pediatrics.
- Visual side-by-side acceptance by a pediatrician or authenticated end-to-end mentor / trainee testing.
