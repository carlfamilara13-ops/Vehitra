# Vehitra

Vehicle companion app: garage, ride tracking (works offline), parts and maintenance, deadlines.
Android first (Expo / React Native). Product rules live in the project context; engineering docs live in `docs/`.

**Status:** Phase 1 — foundation. Phase 0 (GPS proof-of-concept) passed; see `docs/decisions/0001-gps-architecture.md`.

## Docs
- `docs/REPOSITORY_STRUCTURE.md` — folders, boundaries, conventions
- `docs/ARCHITECTURE_NOTES.md` — data model, mileage ledger, maintenance, sync, retention
- `docs/SECURITY.md` — Row Level Security rules and checklist
- `docs/PHASE1_PLAN.md` — build order and exit criteria
- `docs/decisions/` — architecture decision records

## Ground rules
- Incremental changes only; inspect before changing; no invented files or APIs.
- Pure business rules live in `src/domain` (no React/Expo imports) so they can be unit-tested.
- No secrets in the app or the repo. Row Level Security before any real user data.
