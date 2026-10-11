# Step 4 — GPS module port (revision 2, after review)

Scope: local ride recording only. No cloud sync, no auth, no garage, no odometer/ledger, no maps.
Revision 2 fixes seven reviewed issues. Each was first reproduced on the previous patch (see "Evidence").

## Review issues and fixes
| # | Issue (confirmed) | Fix | Regression tests |
|---|---|---|---|
| 1 | The screen only checked foreground permission and could start a ride without background location | Start is blocked unless foreground AND background are granted (`permissionPolicy`, `startFlow`, and again inside `startRide`). The screen explains the requirement and offers Try again and Open app settings (the prompt cannot be shown again after a permanent denial). Notifications denied = visible warning, not a blocker. | `permissionPolicy.test`, `startFlow.test` (start never called when background is denied; retry path; error paths) |
| 2 | Recovery state lived only in screen state; "Keep recording" hid it and Stop saved the ride as `finished` | Persisted in the database (migration 002: `interrupted`, `interruption_count`, `interruption_s`, `recovery_state`). `finishRide` upgrades `finished` to `recovered` for an interrupted ride. The banner is derived from the database and cannot be dismissed. | `ridesStore.test`: interruption persisted, Stop still saves `recovered` + `needs_review`, even for an interruption shorter than the untracked threshold |
| 3 | One polyline was built from all points: straight leg across gaps, low-accuracy spikes included | `buildRoute` uses only usable fixes (accuracy known and <= 25 m) and splits at the same gap rule as the distance. Stored as `route_segments` (JSON). The single `polyline` column is set only for a complete one-piece route, otherwise NULL | `route.test`, `ridesStore.test` (gap + spike scenario, one-piece scenario, no-usable-fix ride) |
| 4 | After an integrity mismatch only `point_count` changed | Every total is rebuilt from the rows that really exist, the ride gets `integrity_issue` and `needs_review`, and `integrity_mismatch` + `integrity_repaired` events are logged. Fewer rows and more rows than the counter are both handled | `ridesStore.test` (deleted block: distance, untracked time and max gap recomputed; extra row) |
| 5 | Average speed divided by the whole ride duration | Tracked time is defined and stored: `tracked_s = (last usable - first usable fix) - untracked gaps`. Average speed = filtered distance / `tracked_s`, or NULL below 5 s tracked | `summary.test`, `ridesStore.test` |
| 6 | Two concurrent starts left an orphaned `recording` ride; an unsorted batch lost fixes | `createRide` is an atomic check-and-create (`RideAlreadyActiveError`). Start/stop/resume run through one lifecycle queue. Batches are sorted chronologically. Orphaned `recording` rides are closed as `recovered` and flagged. The task stops a foreground service that runs with no active ride | `ridesStore.test`, `processFixes.test`, `queue.test` |
| 7 | A registered task was treated as recovery, with a comment claiming Phase 0 verified it | Nothing is assumed. After an interruption the app waits for a FRESH fix stored after the relaunch (a cached pre-launch location does not count), restarts tracking once if none arrives within 20 s, then marks recovery `failed` and tells the user. States: verifying / confirmed / failed, with a Retry tracking button. The misleading comment is removed | `recovery.test` (pure decision logic) |

## Semantics now defined
- **Usable fix:** accuracy known and <= 25 m. Only usable fixes define distance, tracked time, untracked gaps and the route. Other fixes are still stored.
- **Untracked gap:** more than 30 s between consecutive usable fixes. Its straight-line distance is recorded in `untracked_gap_m` and is NOT added to `distance_m`.
- **Route:** separate pieces, never joined across an untracked gap.
- **Interrupted:** at launch an unfinished ride has had no new point for more than 10 s.
- **Batch order:** batches are applied in the order the task delivers them. A batch OLDER than already-stored data is dropped and logged, not merged.

## Evidence (reproduced on the previous patch before fixing)
- #2: 20 s interruption, then Stop: `status=finished, needs_review=0`.
- #3: one polyline with a 554 m straight leg across a 160 s gap and a vertex from a 90 m-accuracy fix.
- #4: after deleting 41 of 60 points: distance still 295 m, max gap still 1 s, `needs_review=0`.
- #5: real speed 5 m/s reported as 0.98 m/s.
- #6: two concurrent starts produced two `recording` rides (one orphaned); an unsorted batch of 3 accepted 1.
- #1 and #7 were confirmed by reading the code (native paths).

## What is and is NOT verified
Verified here by automated tests (`npm test`, 75 tests, Node SQLite): ride maths, filters, gap rules, tracked time, route building, integrity repair, recovery decision logic, permission policy and start flow (with injected dependencies), the database layer, migrations including an upgrade from a v1 database, the write queue.
**NOT verified by these tests; needs a phone:** the background task and foreground service, Android permission dialogs, notification behaviour, what Android does after a force-stop or a phone restart, the real screen, the self-stop of an orphaned service in `task.ts`, and `startRide`'s permission re-check.
The previous Phase 0 observation covers ONE phone (POCO, Android 16) after a force-stop and reopen. It says nothing about a phone restart.

## Remaining limitations
- **Cloud route format:** the cloud `rides` table has one `polyline` column. Rides with several route pieces (`route_segments`) cannot be represented there. The sync step must add a cloud migration (`rides.route_segments jsonb`) before pushing such rides, and must hold them back until then. Single-piece rides can use `polyline` as before.
- A batch that arrives late and older than stored data is dropped (data loss accepted, logged as `old_fix_dropped`).
- The stale-fix filter compares fix timestamps with the device clock; a device clock more than about 2 s off the GPS time would drop valid early fixes.
- GPS speed values are not validated at vehicle speeds (Phase 0 was walking only); max and average speed are provisional.
- Poor-accuracy stretches longer than 30 s are treated as untracked (no trusted position), even though fixes arrived.
- Local `rides.user_vehicle_id` is nullable until the garage exists. No mileage ledger entry is created yet.
- `outbox` exists but nothing writes to it until the sync step.

## Device checklist (new builds required; native modules changed)
1. Deny background location (choose "While using the app"), tap START: expect NO ride, the explanation, Try again, Open app settings. Grant "Allow all the time", Try again: the ride starts.
2. 10 min walk with the screen locked: no `gap` events above 10 s.
3. Airplane mode toggled mid-ride: points keep counting.
4. Force-stop for about 1 min, reopen: banner shows "waiting for a fresh GPS fix", then changes to confirmed only after new points arrive. Tap Stop WITHOUT using any banner button: ride must be `recovered` and flagged. Shared report shows `interrupted=1`, `recovery_state`, untracked time.
5. Phone restart mid-ride, open the app: this is an EXPERIMENT. Report what the screen shows (verifying / confirmed / failed) and the events `app_launch`, `recovery_*`, `tracking_restart`. Do not assume it recovers.
6. Tap START twice quickly: exactly one ride.
7. Revoke location mid-ride, start a new ride: no ghost ride remains.
8. Real vehicle ride 5-10 km against the odometer (photograph start/end).
Send the Share report after each.

## Not in this step
Sync, auth, garage, ledger/odometer logic, maps, notifications, battery tuning.
