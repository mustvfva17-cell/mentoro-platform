# MENTORO — Implementation Status

**Updated:** 2026-10-09
**Phase:** Architecture and data-model decisions
**Implementation status:** Documentation only. No migrations, application implementation, or database tests are claimed.

## Accepted through this update

- Decisions register: accepted decisions through L-26.
- Data model and Physical Schema/RLS Contract: design drafts updated to reflect L-26.
- L-25 selects JSON Schema Draft 2020-12 and Ajv 8 for schema definitions and trusted-backend payload validation.
- L-26 requires all application write paths to use a central trusted backend validation path, rejects failed schema publication atomically, and defines safe schema eligibility/rollback principles while preserving historical schema references.
- L-24 defines the database-backed versioned schema registry: stable schema references per template version/log type, trusted backend validation, immutable published definitions, preservation of historical schema references, and restricted/audited schema administration.
- L-23 defines the submitted-record correction lifecycle: complete proposed correction, expected-revision check, one open request per entry, trainee withdrawal before decision, administrative decision authority, stale-request review, and atomic application with complete revision/audit state.

## Not implemented

- No SQL migrations or database changes have been run.
- No RLS policies or trusted transaction functions have been deployed.
- No tests have been executed against PostgreSQL or Supabase.
- Documentation files can be updated directly on GitHub through the connected repository. Local files still require `git pull` to synchronize.

## Remaining review gates

- Finalize the precise open-state predicate and concurrency-safe uniqueness mechanism for correction requests in the migration design.
- Finalize schema-registry storage representation, exact backend technology/deployment boundary, detailed operational publication/rollback runbook, cross-version migration, and historical-entry editing separately.
- Resolve other open decisions only through explicit user approval; L-26 does not approve them.
- Review all design documents together before implementation, then define migrations, grants/RLS, trusted functions, seed data, and rollback strategy.

- L-26 is accepted as a design decision only. No migrations, backend implementation, or database tests have been run.


- L-27 is accepted as a design decision: schema definitions use `schema_definition JSONB NOT NULL`; preserving original JSON text formatting/key order is not required. Cross-version migration, historical-entry editing, and the detailed operational publication/rollback runbook remain open.
- L-27 is design-only. No migrations, backend implementation, or database tests have been run. Other open decisions remain unapproved.


- L-28 is accepted as a design decision covering template publication checks and approval, immutable published versions, separate assignment eligibility, rollback to a verified previously published version, and terminal archival. Detailed operational runbooks, cross-version migration, and historical-entry editing remain open.
- L-28 is design-only. No migrations, backend implementation, or database tests have been run. Other open decisions remain unapproved.
