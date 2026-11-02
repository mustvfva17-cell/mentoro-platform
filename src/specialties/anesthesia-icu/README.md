# Anesthesia & Critical Care HTML Logbook

The original V1 source archive has been audited and ported into a central HTML runtime at `public/logbooks/anesthesia-icu/index.html`. The runtime uses the central MENTORO authenticated HTML state bridge and centralized Mentor Review; the original standalone localStorage persistence is retained only for an isolated preview mode.

## Imported source catalogue

- 157 roadmap rows: 69 Core, 61 Expanded, 27 Advanced.
- 17 source roadmap groups; every row is assigned exactly once.
- Nine Perioperative & ICU Patient Journey prompts.
- Five Clinical Interpretation & Decision-making prompts.
- Five emergency templates with red flags, differential diagnoses and investigations.
- Total catalogue items including supplemental prompts: 171.

## Governance and release gates

- The original source states that Tier / Depth / Frequency assignments require review by an anesthesiologist or intensivist.
- Trainee-controlled `mentorVerified` / `mentorDate` fields have been removed. Existing legacy values are stripped when state is normalized. Mentor decisions are recorded only through the central Mentor Review workflow.
- Module lifecycle remains `draft`; its proposed template seed remains inactive and non-assignable.
- No clinical approval, Supabase migration execution, authenticated end-to-end acceptance, Vercel Preview, or production deployment is claimed.

## Runtime boundary

The asset uses `MENTORO_LOGBOOK_READY`, `MENTORO_LOGBOOK_LOAD_STATE`, `MENTORO_LOGBOOK_STATE_CHANGED`, and the shared read-only mentor-review messages. Clinical state in platform mode is never read from or written to localStorage.
