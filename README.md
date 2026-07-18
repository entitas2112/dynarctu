# DYNARCTU — Sistem Evaluasi Belajar

A quiz/evaluation platform for Indonesian TKA prep (SD/SMP/SMA), rebuilt
on a security-hardened, single-process FastAPI backend.

## Quick start

```bash
python server.py
```

That's it. On first run this will:

1. Install any missing Python dependencies (from `requirements.txt`).
2. Generate a `.env` file with a fresh, random admin token and session
   secret (printed once to the terminal — save the admin token somewhere
   safe if you plan to use the admin API).
3. Create the local SQLite database under `var/`.
4. Start the server at `http://0.0.0.0:8000`.

Open `http://localhost:8000` in a browser. Requires Python 3.10+.

To stop, press `Ctrl+C`. Re-running `python server.py` reuses the same
`.env`/database — it will not overwrite your admin token.

## Configuration

All configuration lives in `.env` (auto-generated, git-ignored). Notable
options:

| Variable | Default | Purpose |
|---|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `8000` | Bind address |
| `ADMIN_TOKEN` | random | Bearer token for `/api/admin/*` |
| `SESSION_SECRET` | random | HMAC key signing the anonymous device-history cookie |
| `ENABLE_HSTS` | `false` | Set `true` only when served over HTTPS |
| `ALLOWED_ORIGINS` | empty | Extra origins allowed to call the API cross-origin (leave empty for same-origin deployments — the default and recommended setup) |
| `SSL_CERTFILE` / `SSL_KEYFILE` | empty | Let Uvicorn terminate TLS directly, instead of a reverse proxy |
| `RATE_LIMIT_*` | see `.env` | Per-minute request caps per client IP |

For a real production deployment, put this behind a reverse proxy (nginx,
Caddy, or a cloud load balancer) that terminates TLS and forwards
`X-Forwarded-For`.

## Architecture

```
server.py            Single-command launcher: bootstraps deps/secrets, starts Uvicorn
backend/
  main.py            FastAPI app: middleware, error handling, routers, static mount
  config.py           Typed settings from .env
  qdf.py               Server-only QDF (Question Data Format) parser
  quiz_engine.py       Question selection + server-authoritative grading
  sessions.py          In-memory, TTL'd quiz session store
  db.py                Async SQLite (parameterized queries) for question-rotation history
  security.py          Signed device-id cookie, secure headers, rate limiter, admin auth
  schemas.py            Pydantic request validation
  routers/
    quiz.py             Public quiz API
    admin.py            Bearer-token-protected admin API
web/                    Static frontend (HTML/CSS/JS) — served as-is, no build step
data/                   Question banks (.qdf) — server-side only, never mounted publicly
docs/                   QDF format specification (reference material)
```

### Why the backend was restructured

The original version shipped raw `.qdf` question-bank files (containing the
correct answers) straight to the browser as static files, and graded
answers in client-side JavaScript. That means anyone could open dev tools
(or just `curl /data/sd/mtk.qdf`) and read every answer key.

This rebuild moves all of that server-side:

- The browser only ever receives a *stripped* question payload (question
  text + option text, no `Answer`/`IsCorrect` fields).
- Question selection, shuffling, and grading happen in `quiz_engine.py`,
  against the full record kept only in server memory (`sessions.py`).
- `data/` lives outside the static-file mount (`web/`), so it's not
  reachable via any HTTP route at all.

### Security measures implemented

- **No client-side secrets**: answers, grading logic, and the question
  bank never leave the server.
- **Strict input validation**: `jenjang`/`mapel` are checked against a
  whitelist built from the actual files on disk (prevents path traversal);
  `jumlah`/`durasi` are constrained to the same fixed option sets the UI
  offers.
- **Parameterized SQL** everywhere (`aiosqlite`, `?` placeholders) — no
  string-built queries.
- **Rate limiting** per client IP on quiz start/answer/finish and admin
  endpoints.
- **Secure headers** on every response: CSP (no inline scripts allowed —
  MathJax config/nav JS were externalized for this reason), 
  X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy, optional HSTS.
- **Locked-down CORS**: disabled by default (same-origin only); only
  enabled if you explicitly configure `ALLOWED_ORIGINS`.
- **Auth model**: quiz endpoints use short-lived, server-issued bearer
  session tokens (returned in the JSON body, kept in JS memory — never a
  cookie), which sidesteps CSRF for those routes entirely. Admin
  endpoints require a separate `Authorization: Bearer <ADMIN_TOKEN>`
  header (RBAC: public vs. admin). The only cookie set is an
  HMAC-signed, HttpOnly, SameSite=Lax anonymous device id used solely to
  track which non-sensitive question IDs a browser has already seen.
- **Sanitized error handling**: unhandled exceptions return a generic
  `{"error": "internal server error"}` (full details go to the server
  log only, never to the client).
- **API docs disabled in production** (`/api/docs`, `/api/openapi.json`)
  to reduce endpoint enumeration surface; enable by setting `ENV=development`.
- **Secrets management**: `ADMIN_TOKEN`/`SESSION_SECRET` are generated
  randomly on first run, stored in a git-ignored, `chmod 600` `.env` file,
  and never logged.

### Admin API

```
GET  /api/admin/catalog        -> question counts per jenjang/mapel (no content/answers)
POST /api/admin/cache/reload   -> clears the in-memory parsed-bank cache
```

Both require `Authorization: Bearer <ADMIN_TOKEN>` (see your `.env`).

## Editing question banks

Question banks are plain-text `.qdf` files under `data/<jenjang>/<mapel>.qdf`.
See `docs/data-format-new.md` for the full format spec. After editing a
file, either restart the server or call `POST /api/admin/cache/reload`
(with your admin token) to pick up the change without a restart.

## Development

Set `ENV=development` in `.env` to re-enable `/api/docs` and allow the
device cookie to be issued without `Secure` (useful for local HTTP
testing). Do not use this setting in production.
