# Repository Structure

```
vehitra/
  index.ts                 entry; later also imports the background tracking task
  app.json  package.json  tsconfig.json  eas.json (Phase 1 step 2)
  src/
    app/                   app shell: navigation, providers, theme wiring
    features/              one folder per product area
      auth/  garage/  rides/  parts/  maintenance/  dashboard/  settings/
    data/
      local/               SQLite: migrations, repositories
      remote/              Supabase client + remote repositories (only place that talks to Supabase)
      sync/                outbox, upload/download, conflict rules
    domain/                PURE TypeScript business rules (mileage ledger, maintenance status, gap rules)
    config/                env, tracking, retention, map provider
    ui/                    design tokens and shared components
    lib/                   small utilities (geo, ids, dates)
  supabase/
    migrations/            SQL schema + RLS policies (source of truth for the database)
    seed/                  initial vehicle catalog
    tests/                 RLS tests (two-user isolation)
  docs/                    architecture, security, plans, decision records
  scripts/                 dev/ops scripts
```

## Boundaries (enforced in review)
1. `domain/` imports nothing from React, React Native, Expo, SQLite, or Supabase. It takes plain data in, returns plain data out.
2. Only `data/remote` imports the Supabase client. Only `data/local` imports SQLite.
3. A feature may import `domain`, `data`, `ui`, `lib`, `config`. A feature does not import another feature's internals; share through `domain` or `data`.
4. The background tracking task is defined in `features/rides/tracking` and imported from `index.ts` before the app registers.
5. Database changes go through a file in `supabase/migrations`, never by clicking in the dashboard only.

## Conventions
- TypeScript `strict`. File names: `camelCase.ts`, components `PascalCase.tsx`.
- IDs are UUIDs. Every user-owned table has `user_id`, `created_at`, `updated_at`, `deleted_at`, `sync_status` (local).
- Config values (thresholds, retention, map URL) live in `src/config`, never inline.
- Tests: `domain/` gets unit tests first (ledger, maintenance status, gap rules).
- Port from the PoC by module and with review, not by copying the whole project.
