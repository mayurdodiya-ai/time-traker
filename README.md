# Chronos — Tasks & Time

Internal task and time-tracking app in **one Next.js project / one repo / one deployment**:

- **Frontend** — React UI (`src/client`), mounted by Next.js for every page route.
- **Backend** — Next.js route handlers (`src/app/api/[[...path]]` → `src/server`), MongoDB via Mongoose.

```
src/
  app/        Next.js app router: layout, page shell, and the /api catch-all handler
  client/     React UI (pages, task drawer, timer, design system CSS)
  server/     API: models, routes, permissions, timer engine, seed + create-owner scripts
scripts/test/ API integration checks
public/       static assets
PRD.md        product requirements
```

## Local development
Requires Node 20+ and a running MongoDB.

```bash
npm install
cp .env.example .env     # set MONGODB_URI and JWT_SECRET
npm run seed             # demo data (WIPES the database)
npm run dev              # http://localhost:8000  (UI + API together)
```
Demo password for every seeded account: `Password@123` (e.g. `olivia@acme.test` = owner, `raj@acme.test` = manager, `priya@acme.test` = employee).

`npm test` runs the API integration checks (server must be running on a freshly seeded database).

## Deploy
Works on **Vercel** (zero config: import the repo) or any Node host (`npm run build` then `npm start`).

| Env var | Value |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string (allow your host's IPs in Atlas network access) |
| `JWT_SECRET` | random string, 32+ chars — the API refuses to run in production without it |
| `COMPANY_TZ` | optional, e.g. `Asia/Kolkata` — timezone used for timesheet work dates |

**First production user:** do **not** run `npm run seed` in production (it deletes data and creates demo accounts with a known password). Create the owner once, from your machine with `MONGODB_URI` set:
```bash
npm run create-owner -- "Your Name" you@company.com 'a-strong-password'
```
Then invite everyone else from the **People** page.

## Notes
- Timer state and timestamps are authoritative on the server (UTC); durations are stored in whole seconds. A database-level unique index guarantees at most one running timer per user.
- The API connection to MongoDB is cached per server instance, so it is serverless-friendly.
- Back up MongoDB regularly and test restores (Atlas has built-in backups).
