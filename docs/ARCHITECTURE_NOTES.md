# Vehitra — Architecture Notes (rev 4, aligned with the Step 3 migrations)

Labels: **[C]** confirmed requirement · **[R]** recommended decision · **[A]** assumption to verify · **[F]** future

## 1. Measurements, not competing truths [C]
Three different things, never merged into one:
- **Odometer reading** — what the dashboard/user says.
- **Ride distance** — what GPS estimates.
- **Applied mileage** — what Vehitra adds to maintenance mileage.

Priority when they disagree: **user-entered actual odometer > GPS-derived distance > catalog/default estimate.**

## 2. Three layers [C]
| Layer | Holds | Owner |
|---|---|---|
| Catalog (shared) | types, brands, models, component definitions, default intervals, thresholds, images | Admin, read-only for users |
| User data | vehicles, mileage ledger, parts, history, rides, deadlines, settings | User, stored in cloud |
| Device | active ride, raw GPS points, cached catalog slices, sync queue | Local SQLite |

Rule: user records store only what differs from the catalog. [C]
`userVehicle → model_id → user-specific changes/history`; the catalog supplies the rest.

## 3. Catalog entities [R] (see supabase/migrations)
- `vehicle_types`, `brands`, `assets` (images stored once, referenced by id, cached on device)
- `component_definitions` (code, name, category, allowed_actions[], applies_to_types[])
- `vehicle_models` (brand_id?, type_id, slug, name, `is_generic`, sort_order, `current_version`, active). One generic model per vehicle type (brand NULL) for "Can't find your model".
- `model_versions` (model_id, version, `published`): the version registry. Users only see published versions.
- `model_components` (model_id, component_id, **version**, interval_km?, interval_days?, `warn_remaining_pct`, `unknown_history_rule`, `inactivity_rule`, **`review_status` draft|reviewed**, reviewed_by, reviewed_at, source_note). PK (model_id, component_id, version).

Versioning rules (enforced by triggers)
- A user vehicle stores `(model_id, catalog_version)` as a foreign key into `model_versions`: it points at the exact rules it uses, and a referenced version cannot be deleted.
- Rule values of a published version are frozen. Only the review columns may change on a published row.
- To change a number: `catalog_begin_version` (copies as draft, unpublished, invisible to users) -> edit -> `catalog_publish_version`. Existing vehicles keep their old version until the user accepts the update.
- Draft rules are "suggested starting points (unverified)" in the UI, never "recommended". A rule can be `reviewed` only with a named reviewer and date.

`unknown_history_rule` is defined per component, never a global 50%:
- `{ "type": "remaining_km", "value": 750 }`
- `{ "type": "percent_used", "value": 40 }`

## 4. User entities [R]
Every user table has `user_id` (RLS) and uses composite foreign keys so a child row can only reference a vehicle/ride/entry of the SAME user.
- `user_settings` (user_id PK, units, ui_mode, notification_prefs, `raw_retention_days`)
- `user_vehicles` (id, model_id, catalog_version, custom_label?, nickname?, plate?, model_year?, registration_expiry?, soft delete). A vehicle cannot change model in V1.
- `mileage_entries` (insert-only ledger): `kind` (initial | ride | dashboard_reading | adjustment | odometer_replacement | void), `source` (gps | dashboard_reading | manual_adjustment | estimated | initial), `ride_id?`, `gps_distance_m?`, `suggested_km?`, `applied_km`, `odo_reading_after` (NULL only on void), `odo_offset_delta`, `flags[]`, `voids_entry_id?`, `client_created_at`.
  - `applied_km`: distance counted toward maintenance (never negative). Part usage = sum of `applied_km` since install/service.
  - Answers "why does Vehitra think my mileage is 81,566?" by listing entries and their sources.
  - There is no `applied_km` on `rides`: the ledger is the single source of truth.
- `service_events` (insert-only): action (replace | clean | lubricate | inspect | service | baseline | void), `component_id` (catalog component), performed_at, odo_at, `estimated`, `voids_event_id?`. Baselines are always `estimated`.
- `part_installs`: insert; the open row can be corrected or CLOSED (`removed_at`); closed rows are immutable; no deletes; one open install per component per vehicle. Replacement runs through the atomic, idempotent `replace_part_install` function.
- `component_overrides` (user_vehicle_id, component_id, interval_km?, interval_days?, enabled). No per-user component rows exist for catalog defaults.
- `deadlines`, `rides` (summary + encoded polyline; NO raw points), `model_requests`.

Derived, not stored: current odometer, lifetime distance, maintenance status, remaining km/days, component list (from `model_components` at the vehicle's version).
Custom parts/accessories: not in V1; new tables later, nothing here blocks them. [C/R]

## 5. Mileage ledger rules [R]

Definitions
- `E` = running odometer estimate (`odo_reading_after` of the latest non-voided entry). `R` = reading the user enters. `delta = R - E`.
- `applied_km` = distance counted toward maintenance. Never negative. Part usage = sum of `applied_km` since install/service, so displayed-odometer jumps never corrupt maintenance.
- `odo_offset` is DERIVED, not stored on the vehicle: it is the sum of `odo_offset_delta` over non-voided entries. `odo_offset_delta` is non-zero only on `odometer_replacement` entries (it equals `E - R` at entry time). `lifetime_km = odo_reading + odo_offset`, so total distance stays continuous across replacements and rollovers. Maintenance uses `applied_km` only and never depends on the offset.
- Ride example: reading 81,541, GPS 24.6 km applied as 25 km, so E = 81,566 (`kind=ride, source=gps`). Dashboard says 81,580, so entry `kind=dashboard_reading`, `applied_km=14`, `odo_reading_after=81,580`.

Entering a reading
| Case | Rule | applied_km | Running odo after |
|---|---|---|---|
| Same | `delta = 0`: no entry | - | E |
| Normal catch-up | `0 < delta <= plausible_max` | `delta` | R |
| Implausibly high | `delta > plausible_max` (default: max(300 km, days since last reading x 1,500 km)). Ask "That is +X km. Is that right?" Save only if confirmed; flag `large_jump`. Protects against typos like 181,580 | `delta` if confirmed | R |
| Small lower = calibration | `-tol <= delta < 0`, `tol = max(2 km, 3% of km tracked since last reading)`. GPS and dashboard are expected to differ; flags `reading_lowered` + `calibration` | 0 | R |
| Larger lower | `delta < -tol`. **Never auto-classified as a typo.** Ask the user: (a) an earlier entry was wrong, (b) odometer was replaced, (c) odometer rolled over, or cancel | see below | see below |

Larger-lower choices
- **(a) Earlier entry was wrong:** user picks the bad entry; it is voided (see below). The new reading is then re-evaluated as a normal case.
- **(b) Replaced / (c) Rolled over:** `kind=odometer_replacement` (flag `rollover` for c), `applied_km = 0`, `odo_offset += E - R` (E and R as above), running odo = R. Lifetime distance and maintenance are unchanged.
- **Cancel:** nothing saved.
- **Every reading below E carries the `reading_lowered` flag** and appears in a review list. The database also rejects any `dashboard_reading` that adds no distance (`applied_km = 0`) and has no flag.

Voiding (append-only)
- Entries are never edited or deleted. A correction adds a `void` entry that references the voided entry (`voids_entry_id`).
- Void entries have no running odometer (`odo_reading_after` is NULL). Running values are recomputed by replaying non-voided entries ordered by (`client_created_at`, `id`). Voiding a ride removes its `applied_km` from part usage.
- The database forbids UPDATE/DELETE on ledger rows (see SECURITY.md); only inserts are allowed.

Untracked gaps (from Phase 0D): a tracking gap > ~30 s is flagged on the ride. Its straight-line distance is shown as "not tracked" and is not added to `applied_km` unless the user confirms or enters a dashboard reading.

## 6. Maintenance status [R]
- Remaining % per rule = remaining / interval. Distance and time rules are evaluated separately; status is the worse of the two.
- Thresholds live in the catalog (`warn_remaining_pct`), not in code. Due/Attention at ≤ 0 remaining.
- Example: 2000 km interval, 1593 used → 407 km remaining (20.35%) → "Maintenance soon, 407 km remaining".
- Unknown history creates a baseline `service_event` with `estimated = true`, labeled in the UI:
  **"Estimated — maintenance history unknown"**
- Inactivity rules are configurable catalog data, never hard-coded. [C]

## 7. Catalog updates [R]
Existing vehicles do not automatically change maintenance rules. Each keeps `catalog_version_snapshot`. When a newer version exists, the user is notified ("Vehitra has updated the recommended maintenance interval for your vehicle") and must accept before it applies.

## 8. Sync [R]
- **Local SQLite is the first write location** for every offline-capable action (rides, ledger entries, service events, installs, overrides, deadlines). No action requires internet.
- UUIDs are generated on the device. Every cloud write is idempotent by UUID.
- **Outbox** (local): `id`, `table`, `op` (`insert_ignore` | `update` | `rpc`), `payload`, `created_at`, `attempts`, `next_retry_at`, `last_error`, `status`. Retried with backoff; a row leaves the outbox only after the server confirms.
- Insert-only tables (`mileage_entries`, `service_events`) are pushed with `INSERT ... ON CONFLICT DO NOTHING`. An upsert that tries to UPDATE is denied by design.
- Part replacement is pushed as ONE `replace_part_install` call (atomic, safe to retry).
- Editable tables (vehicles, rides, overrides, deadlines, settings, open installs): last-write-wins on `client_updated_at`; the server's `updated_at` is the pull cursor.
- Ride summary + polyline sync independently of raw points. Raw points never go to the cloud.
- Auth requires internet only for sign-up/login/vehicle download; afterwards the stored session is trusted offline. [C]

## 9. Ride pipeline [C/R]
Foreground service → GPS points → batched SQLite writes → ride ends → compute distance/avg speed → queue for sync.
- **Raw local points are never destroyed before the server has confirmed the ride's summary and polyline** (raw points themselves are never uploaded). See retention policy below. [R]
- No per-second uploads. [C]
- **Route storage (cloud): [R] simplified polyline + summary stats** (decided in Phase 0D). Raw points stay on device until the server confirms receipt, then ~30 days.
- Gaps longer than ~30 s are recorded as untracked segments, not silently added to distance. [R]
- Noise rules (accuracy threshold, standstill drift filter): decided after PoC results. [A]

## 9b. Raw GPS retention policy [R] (configurable, in `src/config/retention.ts`)
A ride's raw points may be purged only when ALL of these are true:
1. The server has confirmed the ride (summary + simplified polyline stored). Unsynced rides are never purged, regardless of age.
2. Age exceeds `rawRetentionDays` (default 30; user setting: 7 / 30 / 90 / keep forever).
3. The ride is not active, interrupted/`recovered`, flagged `needs_review`, or pinned by the user.
4. A route can still be shown from the stored polyline (polyline exists).

Other rules
- Low storage can trigger purging earlier, but only among eligible rides, oldest first. Ineligible rides are never purged; warn the user instead.
- Purging deletes only raw points; the summary (`gps_distance_m`, duration, averages) and the polyline stay. `gps_distance_m` is authoritative and is never recomputed from the simplified polyline.
- Mark purged rides with `raw_purged_at`; log a `raw_purged` event; run the purge after sync and on app start, in small batches.
- If unsynced raw data grows large (> `maxUnsyncedRawMb`), warn the user to connect and sync.

## 10. Maps [R]
MapLibre; style URL in one config file; start with OpenFreeMap public tiles; provider stays swappable. Routes are coordinates, so offline we draw the line on a blank dark background. [C]

## 11. Open items
- GPS architecture decided: see VEHITRA_0D_GPS_DECISION.md.
- Battery/OEM handling: needs exact test phone model + Android version. [A]
- Distance-based notification scheduling. [A]
- Admin tooling: seed scripts first, UI after V1 core. [R]

## 12. Security [R]
Row Level Security rules and the checklist are in `SECURITY.md`. Summary: every user-owned table has `user_id` + RLS; catalog tables are read-only for users; ledger tables are insert-only; no secret ever ships in the app; RLS tests must pass before any real user data exists.
