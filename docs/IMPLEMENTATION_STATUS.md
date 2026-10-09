# MENTORO — Implementation Status

**Updated:** 2026-10-09
**Phase:** Architecture and data-model decisions
**Implementation status:** Documentation only. No migrations, application implementation, or database tests are claimed.

## Accepted through this update

- Decisions register: accepted decisions through L-25.
- Data model and Physical Schema/RLS Contract: design drafts updated to reflect L-25.
- L-25 selects JSON Schema Draft 2020-12 and Ajv 8 for schema definitions and trusted-backend payload validation; it requires schema validation before publication and server-side validation before accepting payload operations.
- L-24 defines the database-backed versioned schema registry: stable schema references per template version/log type, trusted backend validation, immutable published definitions, preservation of historical schema references, and restricted/audited schema administration.
- L-23 defines the submitted-record correction lifecycle: complete proposed correction, expected-revision check, one open request per entry, trainee withdrawal before decision, administrative decision authority, stale-request review, and atomic application with complete revision/audit state.

## Not implemented

- No SQL migrations or database changes have been run.
- No RLS policies or trusted transaction functions have been deployed.
- No tests have been executed against PostgreSQL or Supabase.
- Documentation files can be updated directly on GitHub through the connected repository. Local files still require `git pull` to synchronize.

## Remaining review gates

- Finalize the precise open-state predicate and concurrency-safe uniqueness mechanism for correction requests in the migration design.
- Finalize schema storage representation, validation execution boundary, and detailed schema publication/rollback workflows; define cross-version migration and historical-entry editing separately.
- Resolve other open decisions only through explicit user approval; L-23 does not approve them.
- Review all design documents together before implementation, then define migrations, grants/RLS, trusted functions, seed data, and rollback strategy.
