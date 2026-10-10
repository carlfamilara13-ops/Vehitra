# Step 3 — Database implementation plan and review

Scope: Supabase schema (catalog + user tables), RLS, privileges, one RPC, draft seed, automated tests.
Out of scope here: local SQLite schema (step 3e, ported with the GPS module), Edge Function for account deletion, storage buckets, admin UI.

## 1. Your seven points
| # | Requirement | Resolution | Enforced by | Test |
|---|---|---|---|---|
| 1 | Catalog snapshots | `user_vehicles (model_id, catalog_version)` is a foreign key into `model_versions`. `model_components` rows carry `version`. Referenced versions cannot be deleted; published versions are frozen; new versions are copied hidden then published; users accept updates explicitly. | FKs (`on delete restrict`), triggers `guard_model_versions`, `guard_model_components`, `guard_vehicle_models_version`, `guard_user_vehicles` | scenario "published catalog versions are frozen..." |
| 2 | Ownership via the referenced vehicle | Child tables use composite FKs `(user_vehicle_id, user_id) -> user_vehicles(id, user_id)`; same for ride links and voids. RLS `user_id = auth.uid()` on top. Anonymous: no grants, no policies. | composite FKs + RLS + revoked grants | "child rows cannot attach...", "users see only their own rows", "anonymous users cannot..." |
| 3 | Ledger and odometer rules | `odo_offset` is derived (sum of `odo_offset_delta`, non-zero only on replacement) so there is no second source of truth. Lower readings: never auto-typo; flagged `reading_lowered`; DB rejects any zero-distance reading without a flag. Entries/events immutable (triggers, even for admins); corrections are `void` rows. | CHECK constraints, `forbid_modification` trigger, no UPDATE/DELETE grants | "mileage ledger is insert-only...", "a void cannot point..." |
| 4 | Part replacement | `replace_part_install()`: close old + insert new in one transaction, idempotent by new id, runs under RLS. One open install per component (partial unique index). Closed installs immutable; no deletes. | function + `guard_part_installs` + `forbid_delete` | "part replacement is atomic..." |
| 5 | Offline-first sync | Local SQLite first, outbox, `INSERT ... ON CONFLICT DO NOTHING` for insert-only tables, one RPC for replacement, LWW on `client_updated_at`. Documented in ARCHITECTURE_NOTES section 8; local schema comes in 3e. | schema supports it (client UUIDs, `client_created_at`, `client_updated_at`) | idempotent insert + upsert-denied checks in the ledger scenario |
| 6 | Rides and raw GPS | Cloud `rides` holds summary + encoded polyline only; no raw points table exists. Local retention rules stay in ARCHITECTURE_NOTES 9b (`raw_retention_days` setting in `user_settings`). | schema | "rides keep summary + polyline...", structure test |
| 7 | Draft vs reviewed | `review_status` draft/reviewed (reviewed needs reviewer + date), `source_note`. Seed is all draft; only spec-provided values filled (motorcycle engine oil 1,500 km, unknown start 750 km). | CHECK constraint, seed | "seeded rules are draft..." |

## 2. Conflicts found between the earlier design and the notes / SECURITY.md (all resolved in this patch)
1. SECURITY.md listed `part_installs` as append-only; Replace must close the old row. Now "close-only" with triggers. Docs updated.
2. SECURITY.md granted DELETE on user tables. Now no DELETE except `component_overrides`; soft delete + account-deletion cascade.
3. DATA_MODEL proposed `user_vehicles.odo_offset`; ARCHITECTURE_NOTES derives it from the ledger. Column dropped; derived.
4. Notes listed `user_components` and `user_component_id` references; D3 removed per-user component rows. Notes now use `component_overrides` and `(user_vehicle_id, component_id)`.
5. Notes put `applied_km` on `rides`; the ledger is the single source. Removed from rides.
6. Notes lacked catalog `version`, `model_versions`, `is_generic`, `review_status`. Added.
7. Notes said every entry has `odo_reading_after`; void rows have none (NULL, recomputed by replay). Notes updated.
8. Notes had "calibration" flag only; requirement is that lower readings are flagged for review. Added `reading_lowered` flag and a DB check.
9. Notes 9 said "server confirms receipt" of raw points, but raw points never upload. Clarified to "summary + polyline confirmed".
10. Sync: a plain upsert would try to UPDATE insert-only rows and be denied. Notes now specify `ON CONFLICT DO NOTHING`.
11. LWW needs a client timestamp; added `client_updated_at` / `client_created_at`.
12. Account deletion needs a server-side path (auth users cannot be deleted from the client). Documented as pre-release TODO; cascade already tested.
13. SECURITY.md definition-of-done lacked cross-user reference tests. Added and implemented.

## 3. What the patch contains
- `supabase/migrations/` (4 files): helpers, catalog, user tables, RPC + RLS + grants.
- `supabase/seed/seed.sql` (idempotent) + `REVIEW_CHECKLIST.md`: 7 types, 5 brands, 15 components, 14 named models + 7 generic models, 231 draft model-component rows. Yamaha Sniper 155 sorts first.
- `supabase/tests/`: 15 scenarios; `npm run test:db` (in-process Postgres, no Docker) and `npm run test:db:cloud` (DEV Supabase project).
- Updated docs: ARCHITECTURE_NOTES (rev 4), SECURITY, PHASE1_PLAN, this file.

## 4. Test coverage (15 scenarios, all rolled back)
RLS on every table, no anon grants, no stray DELETE grants, no raw-points table - anonymous denied everywhere - catalog read-only, admin functions blocked for users - draft/reviewed rules - catalog versioning, hidden unpublished versions, frozen rules, snapshot stays, explicit accept, no model switch - isolation across all 9 user tables (select/update/delete/insert-as) - cross-user references via vehicle, ride, void, component - ledger constraints, flags, immutability (users and admins), idempotent insert, upsert denied - service events - overrides without default rows - atomic/idempotent part replacement and history protection - rides constraints - settings/deadlines/requests - account-deletion cascade.
The suite was mutation-checked: removing an RLS policy, the ledger trigger, the owner-aware foreign key, the anon revoke, or the cascade guard each makes it fail.

## 5. Steps for you (dev Supabase project)
1. Create a SEPARATE dev project at supabase.com (free tier; pick the region closest to the Philippines). Never use real user data in it.
2. Apply `supabase/migrations/*.sql` in filename order, then `supabase/seed/seed.sql`, in the dashboard SQL editor (or `npx supabase link` + `npx supabase db push`).
3. Copy `.env.test.example` to `.env.test`, fill the DEV connection string, run `npm run test:db:cloud`.
4. First cloud run: the fixture inserts into `auth.users` (id, email) directly; if your project requires more columns the first run may need a small fix. Tell me the error.

## 6. Known limitations (accepted for V1)
- A vehicle cannot change model (a future "re-link" feature).
- Closed part installs cannot be corrected (a correction mechanism can come later).
- A void entry can itself be voided; the replay logic in `domain/` will ignore voids of voids (to be unit-tested).
- Draft intervals are mostly NULL by design: maintenance status needs reviewed values before it can be shown for those components.
