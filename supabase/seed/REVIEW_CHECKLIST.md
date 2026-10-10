# Catalog review checklist (all seeded rules are DRAFT)

Nothing in the seed is verified or manufacturer-approved. Vehitra is not an official manufacturer application and does not copy manuals.
In the app, a draft interval must be labelled as a "suggested starting point (unverified)", never as a recommendation.

## What the seed contains
- Filled from the project spec only: motorcycle engine oil = 1,500 km; unknown history starts at 750 km remaining.
- Every other `interval_km` / `interval_days` is NULL (not set). Components still exist so history, installs and overrides work.
- Which components apply to which model (chain, coolant, CVT belt, gear oil) is a best-effort draft and must be verified per model.
- Generic models list every motorcycle drivetrain/cooling component; users can disable irrelevant ones (component override).

## To mark a rule reviewed
1. Check an authoritative source (owner's manual, manufacturer service schedule) or have a qualified mechanic review it. Record where in `source_note`.
2. `update model_components set review_status = 'reviewed', reviewed_by = '<name>', reviewed_at = now(), source_note = '<source>' where ...`
   (Allowed on published versions: it does not change the numbers existing vehicles use.)
3. To CHANGE a number, use `catalog_begin_version(model)`, edit the new unpublished version, then `catalog_publish_version(model, version)`.
   Existing vehicles keep their old version until the user accepts the update.

## To review first
- yamaha-sniper-155 (priority model): oil, spark plug, chain, coolant, brake pads/fluid, tires, battery.
- Then the remaining 13 named models, then generic models.
