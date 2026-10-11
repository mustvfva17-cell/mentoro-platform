# MENTORO Platform

MENTORO is a medical training and mentorship platform. This repository is currently being scaffolded from the accepted architecture and decision documents.

## Stack

- Frontend: Vite, vanilla JavaScript, CSS
- Protected API: Vercel Node.js Functions
- Identity: Supabase Auth (integration not enabled yet)
- Database: Supabase PostgreSQL with reviewed grants, RLS, and atomic database workflows (schema not created yet)
- Specialty payload validation: Ajv 8 with JSON Schema Draft 2020-12 (not installed or wired yet)

## Local development

Requirements: Node.js LTS and npm.

```sh
npm install
npm run dev
```

The frontend development server does not emulate Vercel API functions. To test the API locally, install/use the Vercel CLI and run:

```sh
npm run dev:vercel
```

Build the static frontend with:

```sh
npm run build
```

## Environment variables

Use `.env.example` as a names-only template. Copy it to a local `.env` only when the relevant integration is implemented. Never commit real credentials.

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are public browser configuration values for approved client-side Auth use only.
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are used by the server-side token-verification endpoint. A publishable key is not a secret, but keep it in server configuration for this endpoint.
- `SUPABASE_SECRET_KEY` is reserved for separately reviewed privileged workflows and is not used by `/api/auth/me`. Never prefix secrets with `VITE_`, send them to the browser, or commit them to Git.
- Configure local/Preview values to the `mentoro-platform-test` Supabase project. Do not copy production credentials into test environments.

`@supabase/supabase-js` is used by the server-only `GET /api/auth/me` endpoint to verify a caller-supplied Supabase access token. This endpoint does not create sessions, read application tables, or authorize platform roles. The browser Auth flow, database writes, migrations, RLS policies, RPCs, and Ajv validation are not implemented.

## Architecture and decisions

Read `ARCHITECTURE.md` and the documents under `docs/` before implementing protected workflows. Accepted design decisions remain binding. Sensitive multi-step writes require a reviewed atomic boundary and audit writes must commit or roll back with the protected operation.

## Current scope

This is an early foundation. `/api/health` reports application-shell status only, not database readiness. `GET /api/auth/me` verifies a Supabase access token and returns minimal identity information; it is not a platform-role authorization check. No database schema, RLS policies, privileged RPCs, or production data writes exist yet. Do not enter patient-identifying information.
