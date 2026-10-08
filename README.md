# MuaLauncher Backend

Next.js App Router + TypeScript project.

Product requirements and the current launcher integration status are recorded in
[MUA backend requirements](docs/mua-backend-requirements.md). The current phase is
requirements recording; the management panel and release pipeline are not yet
implemented.

The proposed [minimal data model](docs/minimal-data-model.md) and
[permission matrix](docs/permission-matrix.md) describe organizations, members,
organization and server authorization, and one dedicated client per server with
independent release history. These are design documents; no
application tables or authentication features have been implemented yet.

Authorization is planned in two stages: application-level RBAC first, then
PostgreSQL RLS as an additional layer. Neither has been implemented yet.

## PostgreSQL and Prisma

Prisma ORM 7 uses the PostgreSQL driver adapter. The local database runs in the
existing Docker container `mualauncher-psql`, published on `127.0.0.1:5432`.

Copy `.env.example` to `.env` and replace `YOUR_PASSWORD` with your local database
password. `.env` is ignored by Git. The local `.env` has already been configured
for the supplied connection. Keep environment files at the project root.

```powershell
npm ci
npm run db:validate
npm run db:check
```

`npm ci`, `npm run dev`, and `npm run build` generate the Prisma client
automatically. To generate it manually or inspect the database:

```powershell
npm run db:generate
npm run db:studio
```

Import the shared client in server-side code (Server Components, Route Handlers,
or Server Actions):

```typescript
import { prisma } from "@/lib/prisma";

const rows = await prisma.$queryRaw`SELECT 1 AS ok`;
```

The client reuses its connection pool during development hot reloads. It is
marked `server-only` and cannot be imported by Client Components. Prisma CLI and
`db:check` load `.env` using `dotenv`; Next.js loads environment files itself.

No application models or migrations have been created yet. After adding models
to `prisma/schema.prisma`, create and apply a development migration, then
regenerate the client:

```powershell
npm run db:migrate -- --name init
npm run db:generate
```

Apply committed migrations in production using `npm run db:deploy`.
`db:check` only performs a read-only query and does not modify database tables.

## Local development

```powershell
npm run dev
```

Open http://localhost:3000.

## Production on this computer

```powershell
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

Stop with Ctrl+C. The background process launched during initial setup is not an auto-start Windows service.

## Install dependencies using the local proxy

```powershell
$env:HTTP_PROXY = 'http://localhost:7897'
$env:HTTPS_PROXY = 'http://localhost:7897'
$env:npm_config_proxy = 'http://localhost:7897'
$env:npm_config_https_proxy = 'http://localhost:7897'
npm ci
```

System fonts are used so builds do not require Google Fonts access.
