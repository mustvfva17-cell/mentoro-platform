# Neurology HTML Logbook Integration

## Status

The Neurology runtime is registered as an HTML specialty module in the central MENTORO application. Its template remains a private clinical-review draft: `lifecycle: draft`, database version `DRAFT`, and `is_assignable = false`.

This integration completes the initial scaffold merged in PR #14 by adding the source clinical catalogue, the shared runtime bridge, and validation for the imported source structure.

## Imported source content

Source archive: `mentoro-neurology-logbook-project-v1-fixed.zip`.

- 115 roadmap rows, preserving each source item, Tier, Depth, and Frequency.
- Source tier distribution: 52 Core, 41 Expanded, and 22 Advanced rows.
- 13 source roadmap groups, with explicit boundary validation to ensure all 115 rows are covered exactly once.
- Nine patient-journey prompts and five clinical-interpretation prompts.
- Five emergency templates, each retaining its red flags, differential diagnoses, and investigation prompts.

The original README explicitly says Tier / Depth / Frequency still require review by a neurologist. The import is a technical port, not clinical approval.

## Platform integration

- Runtime path: `/logbooks/neurology/index.html`, registered through `src/logbooks/module-registry.js`.
- The central Admin preview catalogue and registered HTML routing derive from the shared registry.
- The runtime uses instance-scoped browser cache and the existing authenticated parent-window state bridge.
- Stable item IDs support the existing trusted item-digest mentor-review RPCs.
- Mentor review is read-only for trainee records; mentor decisions are submitted through the parent application.
- JSON backup export is disabled before cloud state has loaded and in read-only views.
- The runtime does not copy legacy localStorage data from the source standalone project into a trainee instance.

## Proposed database updates

The two Neurology migrations extend the six trusted HTML runtime / state / review functions to allow `/logbooks/neurology/index.html` and seed `neurology-html` as an inactive, non-assignable draft.

The allowlist migration carries forward the latest direct-admin-aware HTML state load/save implementations and the current publication/versioning and mentor-review integrity rules. It does not change enrollment ownership or broaden mentor scope.

No Supabase migration has been applied by this work. PostgreSQL execution remains a required staging validation step.

## Clinical governance gate

Before assignment, an authorized clinical reviewer must review the Tier, Depth, Frequency, and emergency prompts, record the clinical approval, and have an authorized administrator publish the template. Until then, Neurology remains non-assignable.

## Not included

- The broader one-persistent-logbook-per-trainee-specialty schema redesign and enrollment association rollout.
- Live Supabase migration execution or staging database validation.
- Clinical approval or publication of the Neurology template.
- A visual side-by-side acceptance review by a neurologist.
