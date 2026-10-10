# Security Rules (Supabase / Postgres)

The anon key is public by design: it is bundled in every copy of the app. **Row Level Security is the protection, not hiding keys or hiding database calls in the app.**

## Rules
1. **RLS enabled on every table in the `public` schema**, including catalog tables. A table without policies denies everything.
2. **User-owned tables:** column `user_id uuid not null default auth.uid()`. Policies only where `user_id = auth.uid()`, and INSERT `with check (user_id = auth.uid())`. Child tables carry `user_id` too AND use composite foreign keys `(user_vehicle_id, user_id)`, so a row can never reference another user's vehicle, ride or entry (the foreign-key check ignores RLS, so it cannot be bypassed by hiding rows). Users get no DELETE privilege except on `component_overrides`; records use soft delete (`deleted_at`) and are removed in bulk only by account deletion (cascade).
3. **Insert-only tables** (`mileage_entries`, `service_events`): INSERT and SELECT only, plus a trigger that rejects UPDATE/DELETE for EVERY role including admins (cascading account deletion is the only exception). Corrections are new `void` rows. **`part_installs`** is close-only: the open row may be corrected or closed (`removed_at`); closed rows are immutable by trigger; no deletes; one open install per component. Part replacement is one atomic, idempotent function (`replace_part_install`).
4. **Catalog tables** (types, brands, models, versions, component definitions, model components): SELECT for `authenticated`; unpublished versions are invisible; nothing writable by users. Published versions are frozen by trigger (only review columns may change). Catalog admin functions (`catalog_begin_version`, `catalog_publish_version`) are executable only by `service_role`. Catalog changes go through migrations/seed or a trusted admin path, never the app.
5. **Storage:** catalog images in a read-only public bucket; user files in a private bucket with policies scoped to the path prefix `<user_id>/`; enforce size and type limits.
6. **Secrets:** the service_role key never goes in the app, the repo, `EXPO_PUBLIC_*` variables, or EAS public variables. `.env` is git-ignored; `.env.example` has placeholders only.
7. **Account deletion:** required by the Play Store. All user rows cascade from `auth.users`. Deleting an auth user needs the service role, so the app will call a server-side function (Edge Function) that verifies the caller and deletes only their own user. TODO before release; the cascade through immutable tables is already tested.
8. **Privacy:** GPS trails are personal data. Collect only what the product needs; document it in the privacy policy before release.

## Definition of done for the schema step
- [x] Migration files for every table include `enable row level security` and policies (test: no public table without RLS).
- [x] Automated test with two test users: user A cannot read, insert as, update, or delete user B's rows in every user-owned table.
- [x] Cross-user references through related records are rejected (rides, ledger, service events, installs, overrides, deadlines, voids, ride links).
- [x] Insert-only tables reject UPDATE/DELETE from users and from admins; closed installs are immutable.
- [x] Users cannot write catalog tables or call catalog admin functions; published versions are frozen.
- [x] Anonymous requests are denied on every table and function.
- [ ] Run the same suite against the DEV Supabase project (`npm run test:db:cloud`) before real data. The local run uses an emulated Supabase `auth` schema.
- [ ] No service_role key anywhere in the repo or build config (search before every release).

## PoC cleanup
- [ ] Drop `poc_points`, `poc_rides` and their open anon policies.
- [ ] Rotate the PoC anon key.

## Test setup
- `npm run test:db` runs the whole suite against an in-process Postgres (no Docker, no cloud). Every scenario runs in a transaction that is rolled back.
- `npm run test:db:cloud` runs the same suite against a DEV Supabase project over a direct connection. It refuses to run unless `VEHITRA_DB_ENV=dev`, and refuses a host listed in `VEHITRA_PROD_DB_HOST`. Put the values in `.env.test` (git-ignored).
- Never run tests against the production project. Never put a database connection string in the app.
