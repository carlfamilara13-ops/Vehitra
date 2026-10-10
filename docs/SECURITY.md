# Security Rules (Supabase / Postgres)

The anon key is public by design: it is bundled in every copy of the app. **Row Level Security is the protection, not hiding keys or hiding database calls in the app.**

## Rules
1. **RLS enabled on every table in the `public` schema**, including catalog tables. A table without policies denies everything.
2. **User-owned tables** (vehicles, mileage entries, parts, installs, service events, deadlines, rides, settings): column `user_id uuid not null default auth.uid()`. Policies: SELECT/INSERT/UPDATE/DELETE only where `user_id = auth.uid()`; INSERT also `with check (user_id = auth.uid())`. Put `user_id` on child tables too (denormalized) so policies never depend on joins.
3. **Append-only tables** (mileage ledger, service events, part installs history): INSERT and SELECT policies only. No UPDATE/DELETE policy, so they are denied. Corrections are new rows (voids).
4. **Catalog tables** (types, brands, models, component definitions, model components): SELECT for `authenticated`; no INSERT/UPDATE/DELETE policy for users. Catalog changes go through migrations/seed or an admin path using the service role on a trusted machine, never in the app.
5. **Storage:** catalog images in a read-only public bucket; user files in a private bucket with policies scoped to the path prefix `<user_id>/`; enforce size and type limits.
6. **Secrets:** the service_role key never goes in the app, the repo, `EXPO_PUBLIC_*` variables, or EAS public variables. `.env` is git-ignored; `.env.example` has placeholders only.
7. **Account deletion:** a user can delete their account and data (required by the Play Store). Design the delete path with the schema.
8. **Privacy:** GPS trails are personal data. Collect only what the product needs; document it in the privacy policy before release.

## Definition of done for the schema step
- [ ] Migration files for every table include `enable row level security` and policies.
- [ ] Automated test with two test users: user A cannot read, insert as, update, or delete user B's rows in every user-owned table.
- [ ] Test confirms append-only tables reject UPDATE/DELETE from a user.
- [ ] Test confirms a user cannot write catalog tables.
- [ ] Anonymous (not logged in) requests return nothing.
- [ ] No service_role key anywhere in the repo or build config (search before every release).

## PoC cleanup
- [ ] Drop `poc_points`, `poc_rides` and their open anon policies.
- [ ] Rotate the PoC anon key.
