# Vehitra — Phase 0D: GPS Architecture Decision

Labels: **[V]** verified on device · **[R]** recommended · **[U]** not yet validated

## 1. Evidence (one device: POCO 24117RK2CG, Android 16, standalone `preview` build)
| Test | Result |
|---|---|
| Screen locked/off in pocket, 64 min | No gaps > 10 s after ride start [V] |
| Airplane mode / Wi-Fi loss mid-ride | Tracking never paused, max gap 2-3 s [V] |
| Swipe from recents | Tracking continued [V] |
| Force-stop | Tracking stops while stopped; resumes ~1 s after reopen; no backfill; outage = time closed [V] |
| Data integrity | `rows_in_db == point_count == rows_synced` on every ride; no `store_error` after the write-queue fix [V] |
| Sync | Uploads right after ride end and on reconnect; idempotent [V] |
| Distance accuracy | 0.652 km filtered vs Strava 0.66 km (-1.2%); raw 0.886 km (+34%) [V, see caveat] |
| Online map | MapLibre + OpenFreeMap draws the route [V] |
| Battery | ~7.7% per ~65 min at BestForNavigation, 1 Hz [V], to be optimized |

Caveat: the accuracy check compared against Strava (another GPS estimate on the same phone), over a short walking route.
It shows our filter agrees with a mature tracker and that the filter removes standstill drift; it is not an independent ground truth.

## 2. Decisions
1. **Tracking engine:** expo-location background task + Android foreground service. No fallback library. `killServiceOnDestroy: false`. [V]
2. **Write path:** every fix goes to SQLite immediately; all multi-statement writes go through one queue; WAL + busy_timeout. No ride state lives only in memory. [V]
3. **Fix filtering:** drop fixes older than ride start (minus 2 s); drop fixes not newer than the last stored one; filtered distance uses accuracy <= 25 m, min move 3 m, standstill rule. Thresholds unchanged. Keep raw distance during beta for diagnostics. [V]
4. **Interrupted rides:** active ride id persisted. On reopen tracking resumes automatically; show "Tracking was interrupted for X min Y s"; user can finish the ride. Never promise tracking through force-stop. [V]
5. **Untracked gaps:** a gap longer than 30 s (tunable) is marked as an untracked segment. Its straight-line distance is shown to the user as "about X m not tracked", not silently added. The mileage correction step handles it. (The PoC still adds it; production must not.) [R]
6. **Sync triggers:** ride end, reconnect, app foreground; send only unsynced data; idempotent by ID. [V]
7. **Cloud route format:** simplified polyline + summary stats. Raw points stay on device until the server confirms receipt, then are kept ~30 days. Reason: ~3,000 raw rows per riding hour is too costly for a free-tier database. [R]
8. **Maps:** MapLibre with OpenFreeMap tiles online; offline draw the stored route on a dark background. Style URL stays in one config file. [V]
9. **Permissions flow:** foreground location, then background location, then notifications; explain each. [R]
10. **Xiaomi/POCO guidance:** onboarding screen for battery "No restrictions" and autostart. The tests ran with "No restrictions". [R]

## 3. Not validated yet [U]
- Vehicle speeds: every test was walking or standing. Needs a real ride (distance vs vehicle odometer, speed readout).
- Other phone brands (Samsung, Oppo, Realme, Vivo) and iOS.
- Play Store variant without ACCESS_BACKGROUND_LOCATION (foreground-service-only), relevant for store review.
- Battery with lower accuracy settings or adaptive sampling.
- Urban canyon / tunnels.

## 4. Cleanup before Phase 1
- Drop the Supabase test tables (`poc_points`, `poc_rides`) and rotate the anon key: the key is inside the APK and the tables allow open anon access.
- (Done) The tracking module was ported into the real Vehitra repo (Phase 1 step 4) and improved there; the PoC repo has been removed.

## 5. Phase 1 entry
Gate passed. Next: create the real Vehitra repo (Expo SDK 57, dev + preview EAS profiles), port the tracking module, build the catalog + user schema.
Side tests for Phase 1 week 1: real vehicle ride vs odometer, foreground-service-only build, battery comparison.
