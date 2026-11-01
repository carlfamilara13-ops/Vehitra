# Vehitra Admin Web

React + Vite + TypeScript admin console for Vehitra catalog operations. It shares the Supabase project used by the Expo app in `../vehitra`.

## Features

- Overview of catalog coverage, releases, requests, and audit activity
- Vehicle catalog and brand management with CSV export
- Draft/published maintenance rules with source review
- Immutable catalog release publishing
- Grouped model-request triage
- Administrator roles, access grants, and suspension controls
- Audit log with filters, detail diffs, and CSV export
- System health, environment details, and deployment notes

## Requirements

- Node.js 20+ and npm
- An existing Supabase project
- The migrations from `../vehitra/supabase/migrations`

## Run locally

```powershell
cd D:\Vehitra\vehitra-web
npm install
npm run dev
```

Vite prints a local URL, usually `http://localhost:5173`.

With no Supabase configuration, the console opens a clearly labelled, read-only demo workspace. Demo data stays in the browser.

## Environment

Create `D:\Vehitra\vehitra-web\.env.local`:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

`VITE_SUPABASE_ANON_KEY` is also accepted as a fallback for older projects. Restart Vite after changing either value.

These values are shipped to the browser and are public client configuration. Never put a Supabase service-role or secret key in this app.

## Backend setup

1. Apply the migrations in `../vehitra/supabase/migrations` in filename order. The admin migration is `20261026000100_admin_console.sql` and must run last.
2. Create the first administrator in Supabase Auth (email and password).
3. Run this SQL in the Supabase SQL editor, replacing the email:

```sql
insert into public.admin_members (user_id, email, display_name, role)
select id, lower(email), 'Owner', 'super_admin'
  from auth.users
 where lower(email) = lower('owner@example.com')
on conflict (user_id) do update
  set role = 'super_admin', status = 'active';
```

4. Sign in at the console. Further administrators can be granted access from the Admins page.

The bootstrap row is required because RLS cannot grant the first role by itself. The SQL only matches an existing auth user; it does not create a password or bypass Supabase Auth.

## Administrator roles

| Role | Access |
| --- | --- |
| `super_admin` | Full catalog access, publishing, request triage, and role management |
| `catalog_admin` | Catalog edits, rule management, and publishing |
| `support_admin` | Admin data read access and model-request triage |

Role and suspension checks are enforced in the database, not only in the UI. The last active super admin cannot be suspended or demoted from the console.

## Security invariants

- All browser access uses the publishable/anon key under Row Level Security.
- Catalog writes go through audited `security definer` RPCs.
- Published catalog versions are immutable except for review metadata.
- Audit events are append-only.
- Vehicle images require a Supabase Storage bucket and policies; uploads are disabled until those exist.

## Verification

```powershell
cd D:\Vehitra\vehitra-web
npm run build
```

Database/RLS and mobile checks live in the sibling project:

```powershell
cd D:\Vehitra\vehitra
npm run test:db
npm test
npm run typecheck
```

## Mobile integration

The mobile app is offline-first and keeps its own local catalog. Publishing a version makes it current for future downloads, but existing vehicles retain their accepted snapshot until the owner explicitly updates. Remote catalog index refresh on mobile remains a separate integration step; the web console does not push to devices directly.
