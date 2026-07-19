# DYNARCTU

Interactive TKA (Tes Kemampuan Akademik) practice-quiz app for SD/SMP/SMA,
rebuilt as a Vite frontend + Vercel serverless-function backend.

Quiz answers are never sent to the browser. Question selection and grading
both happen in the serverless functions under `api/`; the client only ever
receives stripped question payloads (see `api/_lib/quizEngine.ts` →
`toPublicQuestion()`), and the answer key is checked against the copy kept
in the session store (Vercel KV), not against anything the client can see
or tamper with.

## Project layout

```
index.html          Landing page + quiz UI shell
src/                 Frontend (vanilla JS, bundled by Vite)
public/              Static assets (logos) served as-is
data/*.qdf           Question bank, in QDF format (see docs below)
api/_lib/            Server-only shared code — never imported from src/
  qdf.ts             QDF parser
  quizEngine.ts      Question selection, shuffling, grading
  kv.ts              Sessions + used-question history (Vercel KV)
  security.ts        Signed device cookie, admin token check, headers
  validate.ts        Request validation
  handler.ts         Wraps routes: headers + sanitized error responses
  config.ts          Env var loading
api/quiz/            Public routes: catalog, start, answer, finish, history
api/admin/           Admin routes (bearer token required)
api/health.ts        Health check
```

## Prerequisites

- Node.js 20+
- A [Vercel](https://vercel.com) account (for KV storage and deployment)
- The [Vercel CLI](https://vercel.com/docs/cli): `npm install --global vercel`

## Local setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `ADMIN_TOKEN`, `SESSION_SECRET` — required, app fails fast at boot
  without them. Generate with `openssl rand -base64 32`.
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` — see **Attach Vercel KV** below.
  Don't hand-type these; `vercel env pull` fills them in for you once a
  KV store is attached.

### Attach Vercel KV

Sessions and quiz-history dedup used to live in an in-memory dict + local
SQLite file. Serverless functions are stateless between invocations, so
that state now lives in Vercel KV (Redis, via Upstash) instead:

1. `vercel link` (links this directory to a Vercel project — creates one
   if it doesn't exist yet).
2. In the Vercel dashboard: **Storage → Create Database → KV**, then
   **Connect** it to this project.
3. `vercel env pull .env.development.local` (or re-run `vercel env pull .env`)
   to pull the auto-injected `KV_REST_API_URL` / `KV_REST_API_TOKEN` down
   locally.

### Run it

Vite serves the frontend on `:5173` and proxies `/api/*` to `vercel dev`
on `:3000` (see `vite.config.js`), so run both:

```bash
vercel dev          # terminal 1 — serves api/* on :3000
npm run dev          # terminal 2 — serves the frontend on :5173, proxies /api to :3000
```

Open http://localhost:5173.

### Typecheck & build

```bash
npm run typecheck    # tsc --noEmit over api/**/*.ts
npm run build         # vite build → dist/
```

## Deploying

`vercel.json` configures the build (`vite build` → `dist/`), bundles
`data/**` alongside the serverless functions (so `api/_lib/quizEngine.ts`
can read the `.qdf` files at runtime), and sets security headers (CSP,
HSTS, X-Frame-Options, etc.) on every response.

This repo deploys via the GitHub Action in `.github/workflows/deploy.yml`
rather than Vercel's automatic Git integration, so:

- **Disable Vercel's automatic Git deploys** for this project (Vercel
  dashboard → Project Settings → Git → disconnect, or set the production
  branch to something that never gets pushed to) — otherwise pushes to
  `main` will trigger two competing deployments.
- Add these repo secrets (**GitHub → Settings → Secrets and variables →
  Actions**):
  - `VERCEL_TOKEN` — Vercel dashboard → Account Settings → Tokens
  - `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` — found in `.vercel/project.json`
    after running `vercel link` locally once
- Set `ADMIN_TOKEN`, `SESSION_SECRET`, and any optional vars from
  `.env.example` in the Vercel dashboard (Project Settings → Environment
  Variables) for the Production environment — the Action deploys prebuilt
  output, it doesn't upload your local `.env`. `KV_REST_API_URL` /
  `KV_REST_API_TOKEN` are injected automatically once KV is attached.

Every push to `main` then: installs deps → typechecks → builds → (on
`main` only) deploys to production. Pull requests run typecheck + build
only, no deploy.

## Question bank (QDF format)

`.qdf` files live under `data/<jenjang>/<mapel>.qdf` (e.g.
`data/sma/mtk.qdf`). `discoverCatalog()` in `api/_lib/quizEngine.ts` scans
this directory tree at request time to build the jenjang/mapel whitelist —
that whitelist, not raw client input, is what request validation checks
against, which is what prevents path traversal via the `jenjang`/`mapel`
request parameters.

**Note:** `data/sd/mtk.qdf` is currently an empty file (0 bytes) — this
was already the case in the original question bank, not something the
migration introduced. The catalog will still list SD → Matematika as a
choice, but starting a quiz with it returns zero questions; the frontend
already handles this gracefully ("Bank soal untuk pilihan ini masih
kosong"). Fill in that file with QDF-formatted questions whenever you're
ready to add SD Matematika content.

## Security notes

- Answers never leave the server — see `toPublicQuestion()` in
  `api/_lib/quizEngine.ts`.
- Admin routes (`api/admin/**`) require a bearer token matching
  `ADMIN_TOKEN`, checked with a timing-safe comparison
  (`api/_lib/security.ts`).
- Device identity is a signed HMAC cookie (`security.ts`), not a raw
  client-supplied ID.
- Every response gets the same security headers, and every thrown error
  is sanitized before reaching the client (`api/_lib/handler.ts`) — no
  stack traces or internal details leak to the browser.
- Rate limits are enforced per-route via Vercel KV (`checkRateLimit` in
  `kv.ts`) — see `.env.example` for the tunable limits.
