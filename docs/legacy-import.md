# Legacy Filesystem Import

Use this to migrate old filesystem workflow folders into PostgreSQL and copy generated assets into `public/uploads/<projectId>/...`.

## What It Imports

- Workflow JSON files with `nodes` and `edges`.
- `generations/` and `outputs/` files (image/video extensions).
- Asset metadata into `GeneratedAsset` table.

## What It Does Not Import

- Local browser `localStorage` state.
- Existing `.images` or `inputs` folders.
- Historical run logs from disk into `RunHistory`.

## Command

Run with database writes:

```bash
npm run db:import-legacy -- --source /absolute/path/to/legacy/projects
```

Dry run:

```bash
npm run db:import-legacy -- --source /absolute/path/to/legacy/projects --dry-run --verbose
```

Single forced project:

```bash
npm run db:import-legacy -- --source /absolute/path/to/legacy/projects --project-name "Imported Projects" --project-id imported_projects
```

## Flags

- `--source <path>` required.
- `--project-name <name>` optional forced project name.
- `--project-id <id>` optional forced project ID.
- `--uploads-root <path>` optional uploads root override.
- `--no-recursive` disable recursive scan.
- `--dry-run` preview only.
- `--verbose` print each imported item.

## Expected Flow

1. Start DB:
   - `npm run db:up`
2. Apply schema:
   - `npm run db:push`
3. Run import command.
4. Start app:
   - `npm run dev`
5. Open project/workflow in UI and re-save once to normalize metadata.
