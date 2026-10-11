# Phase 1 Plan

| # | Step | Exit criteria |
|---|---|---|
| 1 | Repository + documented structure | Repo created from skeleton, typecheck clean, docs committed |
| 2 | Expo dev + preview build profiles (EAS) | Dev and standalone preview APK both install and open |
| 3 | Database schemas, RLS, seed catalog | Migrations apply cleanly; RLS suite passes locally AND on the DEV Supabase project; 14 named models + 7 generic models seeded as DRAFT |
| 4 | Port the proven GPS module | Ride records offline, survives interruption, syncs; matches PoC behavior |
| 5 | Real vehicle ride vs physical odometer | See below |

## Real vehicle test (step 5)
Use the ported module's `preview` build.
- Ride 5-10 km on a real vehicle with the phone mounted or in a pocket.
- Photograph the odometer (and trip meter if present) at start and end.
- Compare vehicle distance with the app's filtered distance; note raw distance, max gap, and late batches from Share report. A dashboard odometer can itself read a few percent off, so treat the result as a comparison.

## Cleanup tasks before real user data
- Drop `poc_points` and `poc_rides`; remove their policies.
- Rotate the PoC anon key.
- Real project: RLS enabled and tested before the first real user signs up.
