# MENTORO Platform

MENTORO is a medical clinical-mentorship platform built around independent training enrollments and per-enrollment specialty logbooks.

## Stack

- Frontend: Vite, vanilla JavaScript, CSS.
- Protected API: Vercel Node.js Functions, verifying Supabase Auth tokens and relying on JWT-scoped RLS/RPC workflows.
- Identity: Supabase Auth.
- Database: Supabase PostgreSQL with explicit grants, Row Level Security, scoped functions, and atomic booking confirmation.
- Logbooks: one shared engine with versioned specialty templates and one independent instance per enrollment.

## Current status

The independent-enrollment data model and initial schema are implemented in the isolated Supabase test project only. Four versioned migrations are committed under `supabase/migrations/`. All 17 application tables in test have RLS enabled; Supabase Security Advisor reported no findings after the last migration.

The application shell/API is not yet an end-to-end product. Real-user signup, profile provisioning, ID-document review, booking, enrollment, mentor-scoped review, logbook persistence, and browser/build tests remain in progress. The General Surgery template version is deliberately `DRAFT` and cannot be booked until the clinical payload schema is reviewed.

Production Supabase and the existing public `mentoro` website have not been changed by the test migrations.

## Local development

Requirements: Node.js LTS and npm.

```sh
npm install
npm run dev
```

The frontend dev server does not emulate Vercel API functions. To test API routes locally, install/use the Vercel CLI and run:

```sh
npm run dev:vercel
```

Build the static frontend with:

```sh
npm run build
```

## Environment variables

Use `.env.example` as a names-only template. Configure preview/local environments to use the isolated `mentoro-platform-test` Supabase project. Never copy production values into a test environment or commit credentials.

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are public browser Auth configuration values.
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are server-only deployment settings for verifying Auth tokens and making JWT-scoped calls.
- Never expose a Supabase secret/service-role key in a `VITE_*` variable, browser bundle, public asset, or source control.

## Security boundaries

- Client-supplied user IDs, roles, verification flags, enrollment owners, and mentor IDs are never authoritative.
- Training application, review, verification, and booking RPCs derive the actor from the authenticated Supabase JWT or verify that a trusted server-supplied actor matches an active database role.
- Mentor access is derived from the mentor linked to each enrollment, not a trainee-wide relationship.
- A logbook entry, review, and assessment belongs to a specific logbook instance/enrollment. A new booking starts with an empty instance.
- University-ID files must remain in the private `trainee-verification` storage bucket. Do not store patient-identifying information in logbook payloads.
- A `DRAFT` template is never assignable. Publishing a template version requires explicit review and should not alter existing instances.

## Key documents

- `docs/decisions/ADR-03-INDEPENDENT-TRAINING-ENROLLMENTS.md`
- `docs/MENTORO_TARGET_DATA_MODEL_V2.md`
- `docs/IMPLEMENTATION_STATUS.md`

