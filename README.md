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
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are server-only. Never prefix secrets with `VITE_`; never send a secret key to the browser or commit it to Git.

No Supabase client, database writes, authentication flow, migrations, or RLS policies are implemented in this foundation scaffold.

## Architecture and decisions

Read `ARCHITECTURE.md` and the documents under `docs/` before implementing protected workflows. Accepted design decisions remain binding. Sensitive multi-step writes require a reviewed atomic boundary and audit writes must commit or roll back with the protected operation.

## Current scope

This is a foundation scaffold only. The health endpoint is not a readiness check and does not claim database connectivity. No production data or patient-identifying information should be entered.
