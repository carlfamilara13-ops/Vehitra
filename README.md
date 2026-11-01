# Vehitra

Vehitra is a vehicle companion platform consisting of a mobile application
and a web-based administration console.

## Repository Structure

| Folder | Description | Technology |
|---|---|---|
| `vehitra/` | Mobile application | Expo, React Native, TypeScript |
| `vehitra-web/` | Admin web console | React, Vite, TypeScript |

## Projects

### Vehitra Mobile App
Vehicle management, GPS ride tracking, maintenance monitoring,
parts management, and document tracking.

See [`vehitra/README.md`](vehitra/README.md) for setup and documentation.

### Vehitra Admin Web
Web-based administration for vehicle catalogs, maintenance rules,
catalog releases, model requests, administrator accounts, and audit logs.

See [`vehitra-web/README.md`](vehitra-web/README.md) for setup instructions.

## Shared Backend

Both projects use the same Supabase project.

Database migrations are maintained in:

`vehitra/supabase/migrations/`

See the individual project READMEs for configuration and setup.

## Development

Each project has its own dependencies and development commands.
Run commands from the corresponding project directory.
