---
title: "feat: Cloudflare Tunnel + DB Storage"
type: feat
date: 2026-02-18
---

# Cloudflare Tunnel + Database Storage Plan

## Overview

Move project/workflow storage and run history into a database and make the app fully usable over Cloudflare Tunnel (HTTPS). Replace server-side folder picking with database-backed projects. Store generated images on disk with metadata in DB.

## Goals

- Access the app from any device via Cloudflare Tunnel (HTTPS).
- Remove folder picker dependence (no local dialogs on server).
- Store projects/workflows and run history in a database.
- Keep generated files on disk and record metadata in DB.
- Auto-start DB using Docker.

## Architecture

```
Browser (Cloudflare HTTPS)
  -> Next.js API routes
     -> Prisma ORM
        -> PostgreSQL (Docker)
  -> Filesystem (public/uploads/...) for images
```

## Decisions

- Database: PostgreSQL in Docker, auto-start with restart policy.
- ORM: Prisma.
- Storage:
  - Projects/workflows/run history in DB.
  - Image files on disk, metadata in DB.
- Access: Cloudflare Tunnel for HTTPS.

## Database Schema (Prisma)

```
model Project {
  id          String     @id @default(uuid())
  name        String
  description String?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  workflows   Workflow[]
  images      Image[]
  runs        RunHistory[]
}

model Workflow {
  id          String   @id @default(uuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name        String
  data        Json
  version     Int      @default(1)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  runs        RunHistory[]
}

model RunHistory {
  id          String    @id @default(uuid())
  projectId   String
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  workflowId  String?
  workflow    Workflow? @relation(fields: [workflowId], references: [id], onDelete: SetNull)
  startedAt   DateTime  @default(now())
  endedAt     DateTime?
  status      String
  nodeCount   Int
  cost        Float     @default(0)
  error       String?
  logs        Json?
}

model Image {
  id          String   @id @default(uuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  nodeId      String
  fileName    String
  filePath    String
  prompt      String?
  modelId     String?
  cost        Float?
  createdAt   DateTime @default(now())
}
```

## Phase 1: Docker Setup

### Files

- `docker-compose.yml`
- `.env.example` (database connection template)
- `.env.local` (actual credentials)

### Compose

```
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    container_name: node-banana-db
    environment:
      POSTGRES_USER: banana
      POSTGRES_PASSWORD: banana_secret
      POSTGRES_DB: nodebanana
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped

volumes:
  postgres_data:
```

## Phase 2: Prisma Setup

### Dependencies

- `@prisma/client`
- `prisma` (dev)

### Scripts

```
"db:generate": "prisma generate",
"db:migrate": "prisma migrate dev",
"db:studio": "prisma studio",
"db:push": "prisma db push"
```

### Prisma Client

- Add `src/lib/prisma.ts` (singleton).

## Phase 3: API Routes

### New/Updated Routes

- `src/app/api/projects/route.ts` (list/create projects)
- `src/app/api/projects/[id]/route.ts` (get/update/delete project)
- `src/app/api/projects/[id]/workflows/route.ts` (list/create workflows)
- `src/app/api/workflows/[id]/route.ts` (get/update/delete workflow)
- `src/app/api/workflows/[id]/runs/route.ts` (workflow run history)
- `src/app/api/runs/route.ts` (create run entry)
- `src/app/api/images/route.ts` (save image metadata)
- `src/app/api/images/[id]/route.ts` (get image metadata)
- Update `src/app/api/save-generation/route.ts` to write DB metadata

### Remove/Deprecated

- `src/app/api/browse-directory/route.ts`
- `src/app/api/workflow/route.ts` (superseded)

## Phase 4: UI + Store Updates

### UI

- Remove folder picker from `src/components/ProjectSetupModal.tsx`.
- Replace with database-backed project creation.
- Add project list UI (new `ProjectList.tsx` + `ProjectCard.tsx`).
- Update quickstart flow (`src/components/quickstart/QuickstartInitialView.tsx`).

### Store

- Replace `saveDirectoryPath` with `projectId` in `src/store/workflowStore.ts`.
- Update save/load to use DB routes.
- Add run tracking helpers (start/end run).

## Phase 5: Image Storage

- Store generated images on disk:
  - `public/uploads/<project-id>/<filename>`
- Save metadata to DB in `Image` table.

## Phase 6: Cloudflare Tunnel

### Options

- Local install:
  - `cloudflared tunnel login`
  - `cloudflared tunnel create node-banana`
  - `cloudflared tunnel route dns node-banana your-domain.com`
  - `cloudflared tunnel run node-banana`

- Docker sidecar (optional):
  - Add `cloudflare/cloudflared` service to `docker-compose.yml`.

## Testing Checklist

- DB container auto-starts on reboot.
- Prisma migrations run successfully.
- Create/list/update/delete projects.
- Save/load workflows from DB.
- Run history recorded per workflow.
- Image files saved to disk and metadata in DB.
- Access works through Cloudflare Tunnel.

## Migration Notes

- Any existing filesystem-based workflows will require a one-time import.
- Remove local folder picker flows.
- Update UI copy to reflect project-based storage.

## Open Questions

- Where to store Cloudflare Tunnel config (local vs Docker)?
- Do we need multi-user access controls?
