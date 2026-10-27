# ENGINEER ONBOARDING & AUDIT BRIEF — Zaki Media Buyer («الميديا باير»)

**Audience:** the engineer (or model, e.g. GLM) who takes over the repository from the previous assistant, on a different account.
**Written:** 27 Oct 2026 · **Written by:** Claude (previous assistant), who stops after this file. Everything here was checked against the code on `main` at merge `6c115de`. Where something was NOT verified, the text says **VERIFY**.
**Companion file:** `docs/HANDOFF.md` — the step-by-step playbook (rules, SOPs, the four remaining tasks with exact file names, schemas and tests). **This file comes first**: it gives you the map, the permissions, the integrations and the audit plan. `HANDOFF.md` is what you execute afterwards.

Arabic terms are kept in Arabic on purpose (they are the exact words on the screens and in the owner's vocabulary). Do not translate them in the product.

---

## 0. The 60-second summary

- A standalone Next.js app + a separate worker, one Postgres, one Docker image. It manages Meta (Facebook) ads for cash-on-delivery e-commerce in Syria (`SY`) and Jordan (`JO`).
- It decides on **the OMS truth** (real confirmed/delivered orders from the owner's order system), never on Meta's own "purchases".
- **Code computes every number. Models (LLMs) only explain/word things. No customer data ever reaches a model.**
- Every change to Meta is a **ChangeSet** (propose → simulate → approve → execute → verify → follow-up → rollback). Safety actions (pause/reduce) can be automatic; **anything that spends more needs a person on the website — never from Telegram**.
- **Nothing has ever written to real Meta.** `META_WRITE_MODE=dry_run` everywhere. The live site runs in demo mode (`/api/health` → `"mock":true`, all `links` false).
- Built and tested: Phases 1–6 + settings/team/audit, fatigue + studio queue, safety net, agents, import, instant alerts. 197 unit tests, full check 16/16, 10 additive migrations.
- **Left to do:** (a) an independent review/audit of the code (this file, §7), (b) four small tasks (§9 → `HANDOFF.md` PART E), (c) things only the owner can do (keys, accounts) (§10).
- Your first deliverable is **not code**. It is `docs/AUDIT.md` (findings only). See §7 and §9.

---

## 1. Accounts, access and the one thing you must not break

| Item | Value |
|---|---|
| GitHub repository (the ONLY real remote) | `https://github.com/iahmed30004000-wq/zaki-mediabuyer` — **public** |
| Owner's GitHub account | `iahmed30004000-wq` (owner = Ahmad, «أحمد»; e-mail on file in his profile) |
| Branches | `main` (released, auto-deployed) · `feat/structure-and-themes` (the working branch; always merged back by pull request) |
| Image registry | `ghcr.io/iahmed30004000-wq/zaki-mediabuyer` (public image, tags `:main` and `:sha-xxxxxxx`) |
| Site | `https://mediabuyer.zakiai.io` (health: `/api/health`) |
| Server | Coolify at `https://coolify.zakiai.io` — project «Zaki Media Buyer» `eytxdpy4siokvtnvqmwvavf4` → environment `gfzddlrnxdd9grbwh3apaqsh` → service `wqsoxkdltpwmcqudnqgybom9` (Docker Compose = `docker-compose.prod.yml`) |
| Old/other account | `MKory18` — the account the previous local `gh` CLI and an old fork use. It **cannot** see the repo. Ignore it. Local git has two remotes: `origin` (correct) and `mkory18` (old fork; never push there) |

### 1.1 How you (the new account) get in — owner does this once
1. Owner: GitHub → repo → Settings → Collaborators → add your account with **Write**.
2. You accept the invitation, `git clone https://github.com/iahmed30004000-wq/zaki-mediabuyer.git`, then `git checkout -b <your-branch>` from `main` (or use `feat/structure-and-themes`; keep it merged with `main` first).
3. You do **not** receive any secret. You do not need Coolify access: deployment is automatic (§6). If a value must change in production (an environment variable), you ask the owner; he changes it in Coolify.
4. Pull requests are opened from your account into `main`. The workflow (`.github/workflows/image.yml`) tests, merges the PR by itself and deploys. Details in `HANDOFF.md` D7.

### 1.2 Do NOT do these "account" things (they silently break the deploy)
- Do **not** fork, rename, transfer or move the repository. The account name `iahmed30004000-wq` is written in: `docker-compose.prod.yml` (image name), `.github/workflows/image.yml` (image name, Coolify URL default), and in Coolify. If the owner ever moves the repo, all three must change together — that is a planned operation, not something you do on your own.
- Do **not** change visibility of the GHCR package (it must stay public so Coolify can pull without a login).
- Do **not** add repository secrets/variables; `COOLIFY_TOKEN` (deploy call) is the owner's. Without it the workflow prints "deploy by hand" and exits 0.
- Do **not** use the `MKory18` remote or its `gh` login.
- **Pull request #7 «Feat/oms live adapter» (from `MKory18`)** — leave it alone (do not merge, close, comment, rebase). **Important for you to know why:** on a diff against current `main` it DELETES `src/jobs/capi.ts` (the whole CAPI sender, 96 lines) and `scripts/demo-capi.ts`, and rewrites `src/adapters/oms.ts`. It is based on an older tree. If it were merged as is, conversion events (CAPI) would silently stop. The owner decides; if he asks for it to be integrated, port its useful parts (OMS contract schemas under `contracts/oms-mediabuyer.v1/`, `src/server/oms-link.ts`, `scripts/oms-link.ts`, `src/jobs/oms-health.ts`) onto current `main` by hand and keep `capi.ts`.

---

## 2. Rules you must never break (condensed — full text in `HANDOFF.md` PART A)

1. Never put, paste, create or guess a token/key/password anywhere (chat, code, commit, `.env.example`, logs). The repo is public.
2. `META_WRITE_MODE` stays `dry_run`. Only the owner changes it, after a test on a test ad account.
3. Meta is touched **only** through a ChangeSet (`src/server/changes.ts`). Never call `MetaClient.post` from a new place.
4. Spending (raise a budget, resume, create) is approved by a person **on the website**. Telegram can only «اوقف» (pause).
5. A ChangeSet whose source is `agent` always waits for a person (guard in `changes.ts`). Never remove it.
6. No customer name/phone/address to any model, log, report, alert or table. The only place identifiers exist is CAPI send time (fetched from the OMS, hashed in memory, dropped).
7. Migrations are additive only; never edit an existing migration; never run destructive DB commands on production.
8. Five places + settings only (`src/lib/nav.ts`): `اليوم` · `الإعلانات` · `القرارات` · `الإبداعات` · `التقارير` + `الإعدادات`. No new page.
9. Red is for danger only. Colours only from theme tokens. Decoration in four places only.
10. Every number shows its source badge (`ميتا` · `حقيقي` · `تقدير`) and a «ليش؟».
11. Everything created on Meta is created PAUSED, read back, compared, then switched on.
12. Never delete files from Google Drive. Never touch the other systems' folders/repos (OMS, Workspace, content studio) unless a task says so.
13. Talk to the owner **only in Arabic** (simple Jordanian/Syrian), no English words in what he reads. Code, comments, commits and these documents are English.
14. When something does not match this document: **stop and report. Do not improvise.**

---

## 3. What exists (state at merge `6c115de`, live image `24d4c19`)

| Area | State | Where |
|---|---|---|
| Calculator (profit, targets, breakeven) | ✅ spec 17.1 and 17.2 pinned by tests | `src/core/economics.ts` |
| Naming parser (CR code, concept, hook, LP) | ✅ | `src/core/naming.ts` |
| Mature-orders rule | ✅ | `src/core/maturity.ts` |
| Meta read client + sync (insights, objects) | ✅ against fixtures (no real token yet) | `src/meta/*`, `src/jobs/meta-sync.ts` |
| OMS adapter + truth + attribution | ✅ against fixtures | `src/adapters/oms.ts`, `src/jobs/truth.ts` |
| Safety rules + autonomy levels 0–3 + loop guard + kill switch | ✅ | `src/core/rules.ts`, `autonomy.ts`, `src/server/changes.ts` |
| Scale ladder (level 2) | ✅ | `src/core/scale.ts`, `src/jobs/scale-run.ts` |
| Launch wizard + templates + post-create verification | ✅ (dry-run) | `src/core/templates.ts`, `verify.ts`, `src/server/launch.ts` |
| Creatives: Drive intake, MD5 dedupe, naming, policy dictionary, 6 thumbnails, resumable upload | ✅ (Drive/Meta not linked) | `src/jobs/creative-*.ts`, `src/core/policy.ts` |
| CAPI (conversion events) | ✅ (not linked; needs OMS endpoint) | `src/core/capi.ts`, `src/jobs/capi.ts` |
| Account safety (restricted account → level 0; rejections freeze creation) | ✅ | `src/core/account-safety.ts` |
| Experiments (tests with hypothesis/stop conditions) | ✅ | `src/core/experiments.ts` |
| Safety net on Meta itself (account cap + Meta rule) | ✅ (owner-approved, dry-run) | `src/core/safety-net.ts`, `src/server/safety-net.ts` |
| Fatigue + studio request queue | ✅ | `src/core/fatigue.ts`, `src/app/api/vidpattern/queue/*` |
| Agents M01 M02 M03 M04 M05 M06 M07 M10 (+M11 report) | ✅ via gateway; internal model first | `src/agents/*`, `src/gateway/*` |
| Weekly/monthly reports, lessons, plan | ✅ | `src/core/weekly.ts`, `src/jobs/weekly-report.ts` |
| Instant alerts to Telegram | ✅ | `src/core/alerts.ts`, `src/jobs/alerts.ts` |
| Settings (links, caps, products, pages, levels, models) + team by invitation + audit log | ✅ | `src/components/settings/*`, `src/server/{settings,team,audit}.ts` |
| Import (Ads Manager CSV/XLSX) + Excel export | ✅ | `src/io/*` |
| PWA (install, offline page, cache cleared on logout) | ✅ | `src/app/manifest.ts`, `public/sw.js` |
| Backup/restore (logical, nightly 02:30) | ✅ | `src/ops/backup.ts` |
| Studio launch requests (`POST /api/v1/vp/launch-requests` …) + product-market facts | ❌ **not built** (Task E1) | |
| `/setup` shows real state | ❌ still reads mock steps (Task E2) | |
| Real links: Meta, OMS, Telegram, Drive, a model on the server | ❌ owner's keys (§10) | |

**Verification evidence on file:** `docs/FULL_CHECK.md` (16/16, spec 17.4), `docs/PROGRESS.md`, 23 test files / 197 tests (`npm test`), demo scripts under `scripts/`.

---

## 4. Architecture tour (read in this order)

### 4.1 Layers (arrows = allowed dependency direction; never reverse them)
```
src/app (pages, API routes)  →  src/server (DB services)  →  src/core (PURE logic, no DB, no network)
src/jobs (worker jobs)       →  src/server, src/adapters, src/meta, src/core
src/agents → src/gateway (the only door to any model) → privacy filter → internal/external model
src/adapters (OMS, Drive, Telegram), src/meta (Meta client) = the ONLY code that talks to other systems
worker/index.ts = the schedule (cron-like) that calls jobs through a DB lock (runOnce)
```
Rule of thumb for review: if you find arithmetic on money/ratios outside `src/core`, or a `fetch(` outside `src/adapters` / `src/meta` / `src/gateway`, that is a defect.

### 4.2 The main flow (the "decision loop")
```
meta.sync (Meta insights+objects) ─┐
oms.sync  (orders with ad ids)  ───┼→ truth.compute (TruthDaily: confirmed/delivered, MATURE only)
                                   └→ rules.run (every hour :15) → core/rules.ts decides
                                         → propose() creates a ChangeSet (source "rule")
                                             safety (pause/reduce) at level ≥1 → auto-executes
                                             spend increase → state pending_approval (a person on the site)
approve (site only) → execute() → Meta write (dry_run: stand-in ids dry_<ref>_<hex>)
                    → verify (read back & compare) → follow-up (did it help?) → rollback available («رجّع»)
```
ChangeSet states: `draft → simulated → pending_approval → approved → executing → executed | failed | rolled_back | rejected`.
Operations: `pause`, `resume`, `set_budget`, `create`, `set_account_cap`. Placeholders `{{ref:x}}` link created objects. **Create is never retried** (a second try after a lost reply would create a second campaign).

### 4.3 Other flows
- **Creative intake:** Drive `01_inbox` (or studio push / manual) → `processVideo` (`src/jobs/creative-intake.ts`): ffprobe → MD5 dedupe → CR code → name → policy dictionary → 6 thumbnails (ffmpeg) → `CreativeAsset` → `creative.upload` (resumable upload to Meta) → ready for the wizard.
- **Launch:** wizard (4 steps) → `src/server/launch.ts` builds a ChangeSet from templates (`src/core/templates.ts`: 43 Meta "creative enhancements" opted OUT by name) → owner approves → created PAUSED → verified → switched on.
- **CAPI:** `capi.send` every 15 min → for each mature status change builds event id `oms-<order>-<status>` → fetches identifiers from the OMS (`POST /api/v1/capi/identifiers`) → hashes in memory → sends to Meta (events older than 7 days are dropped) → stores only event ids/state.
- **Reports/alerts:** morning report 09:00 (Asia/Amman) to Telegram; alerts read every 15 min with the "two readings in a row" rule (instant ones excepted), sent every 5 min in ONE message.
- **Telegram inbound:** `/api/telegram/webhook` (secret header) → only «اوقف …» creates a safety ChangeSet; anything that spends is refused with a link to the site.
- **Studio ↔ media buyer:** Bearer tokens with scopes `vp:read` / `vp:launch` (stored as sha256 only); see §8.

### 4.4 Data model (Prisma, `prisma/schema.prisma`)
Identity & audit: `User`, `AuditLog`, `Setting`, `SettingVersion`, `ApiToken`. Meta objects: `MetaConnection`, `AdAccount`, `Page`, `Dataset`, `Campaign`, `AdSet`, `Ad`, `ApiUsage`. Numbers: `InsightDaily`, `AttributedOrder`, `TruthDaily`, `UnattributedPool`, `ProductEconomics`, `ProductAlias`. Operations: `JobRun`, `Alert`, `AlertState`, `Report`, `AgentRun`. Creatives: `CreativeAsset`, `CreativeCounter`, `DriveFile`, `PolicyCheck`, `ThumbnailCandidate`, `CreativeRequest`. Changes: `ChangeSet`, `ChangeItem`, `RuleRun`, `Freeze`, `KillSwitchEvent`, `Experiment`. Tracking/health: `CapiEvent`, `AccountHealth`, `ReviewIssue`, `Lesson`, `ImportBatch`.

### 4.5 Files worth reading first (≈ 2 hours, in this order)
1. `CLAUDE.md`, `docs/DECISIONS.md` (D1–D14), `docs/PROGRESS.md`
2. `src/core/economics.ts` + `tests/economics.test.ts` (the money math)
3. `src/core/maturity.ts`, `src/core/rules.ts`, `src/core/autonomy.ts`, `src/core/scale.ts`
4. `src/server/changes.ts` (the heart: propose/approve/execute/rollback/killSwitch)
5. `src/meta/client.ts`, `src/meta/write.ts` (what is allowed to reach Meta)
6. `src/server/auth.ts`, `src/core/roles.ts`, `src/middleware.ts`, `src/lib/session-token.ts`, `src/server/crypto.ts`, `src/server/api-token.ts`
7. `src/gateway/gateway.ts`, `src/gateway/privacy.ts`
8. `worker/index.ts` (the schedule), `src/jobs/runner.ts`
9. `docker-compose.prod.yml`, `Dockerfile`, `.github/workflows/image.yml`

---

## 5. Permissions — the complete picture

### 5.1 Roles (`src/core/roles.ts`, mirrored in spec 13.8 and `tests/roles.test.ts`)
| Capability | OWNER «المالك» | ADS_MANAGER «مدير الإعلانات» | ANALYST «المحلل» | VIEWER «مشاهد» |
|---|---|---|---|---|
| `view` numbers/reports | ✓ | ✓ | ✓ | ✓ |
| `connect_meta` (also import, pages) | ✓ | ✓ | – | – |
| `propose_change` | ✓ | ✓ | ✓ | – |
| `pause_or_reduce` (also rollback) | ✓ | ✓ | – | – |
| `approve_within_cap` | ✓ | ✓ | – | – |
| `owner_only` (above cap, new campaign, levels, rules, models, users, safety net, caps, products, settings, studio tokens) | ✓ | – | – | – |
| `kill_switch` | ✓ | ✓ | – | – |

Owner-only **kinds** of ChangeSet (checked inside `approve()`): `above_cap`, `test_campaign`, `connect_asset`, `customer_audience`, `safety_net`, and anything stopped by `loop_guard`.

### 5.2 Route → guard table (every `route.ts`; checked on this commit)
| Route | Guard |
|---|---|
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/health` | open (login rate-limited, see finding F-01) |
| `POST /api/telegram/webhook` | secret header `x-telegram-bot-api-secret-token` (constant-time compare) + chat-id allow-list |
| `/api/v1/vp/*`, `/api/vidpattern/*` (7 routes) | Bearer token with scope `vp:read` or `vp:launch`, checked inside each route (middleware leaves these paths open on purpose) |
| `POST /api/changes/[id]` | `requireCapability("view")` **then** the real check inside `approve()` / `reject()` / `rollback()` (roles + owner-only kinds) |
| creative thumbnail `GET` · `/api/export` · `/api/consultant` · `GET /api/studio/links` | `view` |
| `POST /api/creatives/[code]` (creative actions) | `approve_within_cap` when the action is `approve`, else `propose_change` |
| `/api/agents/writer` · `/api/agents/prepare` · `/api/launch` · `POST /api/studio/links` | `propose_change` |
| `/api/objects/pause` | `pause_or_reduce` |
| `/api/kill-switch` | `kill_switch` |
| `/api/import` · `/api/pages` | `connect_meta` |
| `/api/accounts/[id]/level` · `/caps` · `/api/products` · `/api/safety-net` · `/api/settings/[key]` · `/api/studio/tokens*` · `/api/team*` | `owner_only` |
| Pages (server components) | Middleware only: needs a **valid signed session cookie** (see finding F-05) |

### 5.3 Sessions
JWT HS256 (`AUTH_SECRET` ≥ 32 chars) in cookie `mb_session` (httpOnly, `sameSite=lax`, `secure` in production, 14 days). API routes reload the user from the DB on every call (`active` + `sessionVer`), so deactivating a user or bumping `sessionVer` invalidates API access immediately. Passwords bcrypt cost 12. Invitations: one-time code (stored hashed), 72 h.

### 5.4 Studio tokens
`mbs_` + 32 random bytes (base64url), shown once, only sha256 stored, scopes `vp:read` / `vp:launch` (+ `vp:sync` reserved), revocable, `lastUsedAt` updated at most once a minute. A studio token **cannot** approve anything (it is not a site session).

---

## 6. Deployment (so you do not break it)
1. PR into `main` → GitHub Actions: `npm ci` → `tsc` → `vitest` → `scripts/scan-secrets.mjs` → `docker build` → start the image with Postgres and probe `/api/health` → **the workflow merges the PR** → publish the image to GHCR → call Coolify (`restart?latest=true`) → wait until `/api/health` returns `"version":"<first 7 of the build sha>"`.
2. Coolify runs `app` (Next, port 3140, runs `prisma migrate deploy` on start), `worker` (`npx tsx worker/index.ts`), `db` (Postgres 16, volume `mediabuyer_db`); file storage volume `mediabuyer_storage` at `/app/storage` (shared by app and worker).
3. Secrets are Coolify-generated (`SERVICE_PASSWORD_*`) or entered by the owner in Coolify's Environment Variables screen. Never in git.
4. Verification after every merge: `curl -s https://mediabuyer.zakiai.io/api/health` → `version` changed; Actions run green.
5. Rollback of code = revert PR (or, emergency only and with the owner told: pin the image tag in Coolify to the previous `:sha-…`).

---

## 7. THE AUDIT — your first job (no code changes, findings only)

Goal: an independent reviewer (you) understands the whole system, then checks **logic, calculations, permissions and security**, and writes what he finds. The owner needs the findings before real keys are connected.

### 7.1 Rules for the audit
- Produce **one file: `docs/AUDIT.md`**, in English, with: scope, method, a findings table (`ID · severity Critical/High/Medium/Low/Info · area · file:line · what · how to reproduce · suggested fix`), then "things checked and found fine".
- **Do not fix during the audit.** Fixes are separate small pull requests *after* the owner reads `AUDIT.md` (he decides priorities). Exception: a typo-level fix in a comment/doc may ride with `AUDIT.md`.
- Reproduce before you claim. A finding without a reproduction or a precise code citation is "Info", not "High".
- Never test against production data or real customers. Use the local DB and the fixtures (`src/adapters/fixtures.ts`). Never try an attack against `mediabuyer.zakiai.io` — read-only `curl` of `/api/health` and checking that API routes answer `401` without a session is fine; nothing else.
- Open one pull request with `docs/AUDIT.md`. Report to the owner in Arabic: how many findings per severity, the top three, and what you need from him.

### 7.2 Part A — Understand (before judging)
Read §4.5 in order. Then run the system locally exactly as `HANDOFF.md` D1 says and click through the six places in demo mode and in real-data mode (`HANDOFF.md` D4; return to `MOCK_MODE=1`). Run `npm run demo:pipeline`, `demo:launch`, `demo:guard`, `check:full` once and read their output. Write a half-page "my understanding" in `AUDIT.md` — the owner can compare it with reality.

### 7.3 Part B — Logic and calculations
For each item: read the code, read the test, recompute by hand or with an independent script (do not reuse the code under test), and list any divergence from `docs/SPEC.md`.
1. `src/core/economics.ts`: spec 17.1 (121.20 · 5.51 · 6.64 · 107.77 · 6.74 · 2.21) and 17.2 (M = 4.16, T_order = 2.50, T_confirmed = 3.84, T_delivered = 5.12). Recompute on paper. Test negative/zero denominators (no orders → null, never `Infinity`/`NaN`). Check all arithmetic uses `Decimal` and money is never a JS float inside `src/core`.
2. `src/core/maturity.ts`: when is an order "mature"? A decision must never use immature orders (spec 6.6). Try boundary timestamps and time zones (Asia/Amman vs UTC; a day boundary at 00:00 Amman).
3. `src/core/rules.ts` against spec 6.4 (safety) one rule at a time: thresholds, `>` vs `≥`, which window, which source (OMS truth vs Meta). A rule that acts on Meta's purchases instead of OMS truth is High.
4. `src/core/scale.ts` against spec 6.5: 3 days under ceiling, ≥5 mature confirmed orders, +20% per 48 h, ≤ +50% per week, 72 h learning guard, product cap → horizontal scaling. Try to find a sequence that exceeds +50%/week or the daily cap.
5. `src/server/changes.ts`: state machine — can a state be skipped? Can an `executed` change be approved again (double spend)? Concurrency: two approvals at once (`move()` should be a compare-and-set). Is the simulation re-run at approval? Is `spendDeltaDaily` computed by code and cannot be supplied by the caller?
6. Loop guard and kill switch: a rule reversing a rollback repeatedly; kill switch scope; what «رجّع» of a kill switch does.
7. `src/core/templates.ts` + `verify.ts`: the 43 opt-out keys against the official Meta SDK v24 (`node_modules/facebook-nodejs-business-sdk`), budgets in cents, account `spend_cap` written in dollars/read in cents (`src/core/safety-net.ts`), ad-rule money filters in cents. A unit mistake here = real money.
8. `src/core/capi.ts` + `src/jobs/capi.ts`: event id uniqueness (`oms-<order>-<status>`), 7-day cut, hashing (SHA-256 of normalized phone/e-mail per Meta rules), nothing stored.
9. `src/core/alerts.ts`: two-readings rule, key stability, no alert storm.
10. Time: all schedules in `worker/index.ts` are Asia/Amman; check DST (Jordan/Syria changed DST rules recently — **VERIFY** what `Intl`/Node do with the `TZ` variable and tzdata in the image).

### 7.4 Part C — Permissions
1. Re-derive the table in §5.2 yourself by grepping `requireCapability|requireToken` over `src/app/api`; confirm no route is missing from it (this file's list was produced on `6c115de`).
2. For every route, test as each role (create four users locally) and as an anonymous caller; confirm the HTTP code matches §5.1. Add this as a script or test (`tests/`), not as prose.
3. `POST /api/changes/[id]`: confirm a VIEWER and an ANALYST cannot approve or roll back (they pass the `view` guard; the real check is inside `approve()`/`rollback()`). Note `reject()` allows `propose_change` (so ANALYST can reject) — decide with the owner whether that is intended.
4. Server-component pages: confirm what a signed-in **VIEWER** sees on `الإعدادات` (links status, team list, audit log, studio tokens list?). Does anything show data above their role? (F-05)
5. IDOR: every route taking an id/code (`/api/creatives/[code]`, `/api/changes/[id]`, `/api/team/[id]`, `/api/studio/tokens/[id]`, `/api/accounts/[id]`) — single-tenant system, but check that ids cannot reach other-type records or escape the intended table.
6. Studio token scopes: a `vp:read` token must fail on every write route; a `vp:launch` token must fail on every site route.

### 7.5 Part D — Security (candidate findings I noted; **all must be verified by you**)
| ID | Candidate | Where | Why it matters / what to check |
|---|---|---|---|
| F-01 | Login rate limit is an in-memory `Map` keyed by e-mail only | `src/app/api/auth/login/route.ts` | Resets on every restart, per-process, no IP key, no lockout; an attacker can rotate e-mails or hit different processes. Suggest DB-backed or edge limiting. Also check the 429 path does not reveal whether an e-mail exists. |
| F-02 | First sign-in creates the OWNER when no user exists; the guard is `OWNER_EMAIL` and the compose default is **empty** (`OWNER_EMAIL=${OWNER_EMAIL:-}`) | same file + `docker-compose.prod.yml` | If the owner has not signed in yet (**VERIFY with him: has the production owner account been created?**) anyone who reaches `/login` first becomes OWNER. Top-priority to confirm and close (set `OWNER_EMAIL` in Coolify). |
| F-03 | No security headers: `next.config.mjs` sets none (no CSP, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `X-Content-Type-Options`, HSTS) | `next.config.mjs` | Clickjacking and weak XSS containment. Check whether Coolify/Traefik adds some (**VERIFY with `curl -I https://mediabuyer.zakiai.io/login`**). |
| F-04 | CSRF: protection relies on `sameSite=lax` cookie and JSON bodies; no CSRF token, no `Origin` check | all POST routes | Lax blocks cross-site POSTs with cookies in modern browsers; confirm no state-changing **GET** exists and that `req.json()` routes cannot be hit with `application/x-www-form-urlencoded`/`text/plain` from a cross-site form. Consider an `Origin` check in middleware. |
| F-05 | Middleware validates only the JWT signature; the DB re-check (`active`, `sessionVer`, role) happens in API routes and `currentCaller()`, but most **pages** do not call it | `src/middleware.ts`, `src/app/(app)/**/page.tsx` | A deactivated or role-downgraded user with a still-valid cookie (≤14 days) may still load page data rendered on the server. Check each page loader. Fix idea: check `currentCaller()` in the `(app)` layout. |
| F-06 | Thumbnail path guard uses `file.startsWith(root)` without a trailing separator | `src/app/api/creatives/[code]/thumb/[n]/route.ts` | `/app/storage-evil/x` would pass `/app/storage`. Paths come from the DB (not from the URL), so exploitability is low; still use `path.relative` check. |
| F-07 | `GET /api/auth/login` tells anyone whether any account exists (`hasUsers`) | login route | Minor info leak; combine with F-02. |
| F-08 | Studio token endpoints have no rate limit and tokens have no expiry | `src/server/api-token.ts` | Spec 9.2 says tokens renew every 90 days — check whether anything enforces that. |
| F-09 | Telegram «اوقف» matches by name `contains` (case-insensitive) and pauses up to 6 live objects in one command when a creative code is given | `src/app/api/telegram/webhook/route.ts` | Pause is the safe direction, but check that an ambiguous query without a code is refused (it is: >1 hit asks to be specific) and that a chat-id allow-list cannot be empty-string bypassed (`filter(Boolean)` is applied). |
| F-10 | Uploads (coming in Task E1) are `multipart` up to 500 MB through Next | future `launch-requests` route | `req.formData()` buffers in memory. When implementing E1, stream to disk and enforce the limit before buffering. Treat as a design constraint for E1. |
| F-11 | Secrets handling | `src/server/crypto.ts` | AES-256-GCM with a key derived by HKDF from `ENCRYPTION_KEY`; refuses to store when no key. Check rotation story (none: changing the key makes stored tokens unreadable → `decryptSecrets` returns null). Document it. |
| F-12 | Dependency risk | `package.json`, `npm audit` | Run `npm audit --omit=dev` and review. Pin/upgrade only with the owner's OK. |
| F-13 | The public image contains `scripts/` (demo scripts) and the whole `src` | `Dockerfile` | Not secret, but the demo scripts write test data if someone runs them in the container with the production `DATABASE_URL`. Document "never run demo scripts in production". |
| F-14 | Prompt injection / privacy filter | `src/gateway/privacy.ts`, agents | An ad name, creative text or OMS field could carry instructions or a phone number into a prompt. Verify the filter refuses phones/e-mails/tokens in **every** prompt path and that model output can never trigger an action without a person (agent ChangeSets always wait). |
| F-15 | SSRF / outbound hosts | `src/meta/client.ts` (paging host check ✓), `src/adapters/oms.ts` (base URL from env), studio video URL intake | Check that any URL that comes from outside (studio `creative.ready` video URL) is validated (scheme, host allow-list, no redirects to internal IPs). |
| F-16 | Logging | whole repo | `grep` for `console.log` of request bodies/tokens; run `scripts/privacy-sweep.ts`. |

### 7.6 Part E — Data and privacy
- Run `npm run check:full` (it includes the privacy sweep: a planted phone number must be caught in all logs).
- Prove "no customer data in the DB": review `AttributedOrder` columns (`capi_ref` is an opaque encrypted reference) and every table for free-text fields that could receive a name/phone.
- Backups: `npm run check:backup` restores into a scratch DB and compares. Check where backups are written (`STORAGE_DIR/backups/<day>`) and that they are not publicly served.

### 7.7 Part F — Operations
Health endpoint, worker lock (`runOnce` with slot) under two worker instances, job failure visibility («صحة المصادر»), what happens when Meta/OMS/Telegram/model are down (spec 9.8: fall back, stay safe, say so).

### 7.8 Output format reminder
`docs/AUDIT.md` → one PR → Arabic summary to the owner. Then **wait** for his decision before fixing anything above Low.

---

## 8. Integrations with other systems (everything the engineer needs)

| System | Direction | Auth | What flows | State | What the OTHER side must provide / do |
|---|---|---|---|---|---|
| **Meta Marketing API v24.0** (`https://graph.facebook.com/v24.0`) | read now; write only via ChangeSet | System User token `META_SYSTEM_USER_TOKEN` (owner, P0.4) | insights (daily, account/campaign/adset/ad), object trees, video upload (resumable), campaign/adset/ad create, status/budget set, ad rules, account `spend_cap`, CAPI events (`META_DATASET_ID`) | Not linked. Client verified against the official SDK; dry-run write mode | Owner: Meta Developer app + Business Manager + System User with permissions on the chosen assets; a **test ad account** (P0.5) before `META_WRITE_MODE=live`. Units: budgets in cents; `spend_cap` WRITTEN in dollars, READ in cents |
| **OMS** (`OMS_BASE_URL`, `OMS_TOKEN`) | read (+ one POST for CAPI identifiers) | Bearer, one token per system, 90-day renewal (spec 9.2) | `GET /api/v1/orders/attribution?updated_since=` (orders with `ad_id`, status, dates, `capi_ref`; **no** name/phone/address); `GET /api/v1/products?fields=code,name,aliases,unit_cost_usd,price_options,stock_days,delivery_fee,return_fee,cod_fee_pct`; `POST /api/v1/capi/identifiers` (D9); optional `GET /confirm-capacity`, `order.status_changed` event | Not linked. Code written against fixtures | The OMS repo (`Documents\Zaki-OMS\oms`) currently exposes `src/app/api/v1/{customers,orders,products}` and **does not have** `orders/attribution` or `capi/identifiers` (VERIFY with grep) — the OMS must add them (spec P0.1/P0.3), and must store `ad_id/adset_id/campaign_id/ad_name`, `fbclid`, `_fbc`, `_fbp` and the international phone per order. Contract examples/schemas exist in PR #7 (`contracts/oms-mediabuyer.v1/`). Do not edit the OMS from this repo |
| **Content studio** («استوديو المحتوى», Python/FastAPI at `C:\Users\LOQ\Pictures\المشروع`, files `launch.py`, `crm.py`, `contracts/vp-ops.v1.yaml`) | studio → media buyer (push + pull) and media buyer → studio (performance) | Bearer tokens `mbs_…` scopes `vp:read`/`vp:launch`, created by the owner in `الإعدادات` | **Done:** performance per video (`GET /api/vidpattern/ad-performance`, alias `/api/v1/vp/performance`), `creative.ready` intake (`POST /api/v1/vp/creatives`), request queue (`GET /api/vidpattern/queue`, `POST …/{id}/claim`, `…/{id}/result`). **Not done (Task E1):** `POST /api/v1/vp/launch-requests`, `GET …/{id}`, `POST …/{id}/cancel`, `GET /api/vidpattern/product-market`, alias `/api/v1/vp/products/{id}/facts`. **Later:** `failure-reasons`, `library` | Partially done | The studio already calls these paths literally (read `launch.py` and the YAML; do **not** edit the studio). Contract text in Arabic: `docs/STUDIO_DATA_CONTRACT_AR.md`. Error body `{code,message}` with Arabic message |
| **Telegram** | bot → owner (reports, alerts); owner → bot («اوقف …» only) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`, `TELEGRAM_ALLOWED_CHAT_IDS`, webhook secret `TELEGRAM_WEBHOOK_SECRET` (Coolify-generated) | morning report 09:00, weekly Sat 10:00, monthly day 1, instant alerts, «اوقف» | Not linked | Owner creates the bot (BotFather), gives the token in Coolify, and calls `setWebhook` with `secret_token` = the secret (a documented one-time step in `README.md`) |
| **Google Drive** | read/move inside the media buyer's own folders | Service Account JSON `GOOGLE_SERVICE_ACCOUNT_JSON`, `DRIVE_PRODUCTS_FOLDER_ID` | per-product folders `01_inbox`, `02_ready`, `excluded` created when missing; files **moved**, never deleted | Not linked | Owner shares the products folder with the service account as Editor. Never rename/move inside the studio's `Zakiai/` tree |
| **Models** | gateway → internal model (Ollama/vLLM, OpenAI-compatible) first, optional external | `INTERNAL_MODEL_BASE_URL/NAME/KEY`, `EXTERNAL_MODEL_*`, `PRIVACY_MODE=internal_only` default | explanations, drafts, plan wording — all numbers come from code; daily/monthly caps (`agents.daily_caps`, `agents.monthly_cap`) | Works locally with Ollama `qwen3:4b-instruct-2507-q4_K_M`; none on the server | Owner provides a model endpoint reachable from the server |
| **Replies system** (WhatsApp/Messenger replies, spec 9.3) | read capacity | — | `GET /api/v1/capacity` | **Not started** (deferred) | That system must expose it; also must send `ad_id`/`ctwa_clid` to the OMS (P0.2) |
| **Coolify** | GitHub Actions → Coolify deploy call | `COOLIFY_TOKEN` repo secret (owner) | restart with latest image | Works | Owner-managed |
| **GitHub / GHCR** | CI + image | `GITHUB_TOKEN` (automatic) | build, merge, publish | Works | — |

Sequence the owner follows to go live safely (so the audit and E1/E2 should be finished before step 3):
1. Set `OWNER_EMAIL` in Coolify and create the owner account (F-02).
2. In `الإعدادات`: products (price, costs, fees), account caps (daily/monthly), landing pages. Check `جهّز النظام`.
3. OMS endpoints live → fill `OMS_BASE_URL`, `OMS_TOKEN` → `oms.sync` turns green.
4. Meta read-only token (`META_SYSTEM_USER_TOKEN`) → set `MOCK_MODE=0` → data appears. Still `META_WRITE_MODE=dry_run`.
5. Telegram bot, Drive service account, a model endpoint.
6. Test ad account → full dry-run → one supervised `live` write on the test account → only then `live`.

---

## 9. The plan (ordered; do not start a step before the previous one is fully finished)

| # | Step | Output | Gate |
|---|---|---|---|
| 0 | Read this file, then `HANDOFF.md` PART A–D. Run the baseline in `HANDOFF.md` D1 | nothing | baseline green (tsc clean, 197 tests) — if red BEFORE you change anything: stop and report |
| 1 | **Audit (§7)** | `docs/AUDIT.md` + PR | Owner reads it and decides which findings to fix |
| 2 | Fix findings the owner approved (small separate PRs: one finding = one PR with a test) | PRs | tests + `check:full` |
| 3 | **E1** studio launch requests + product facts (`HANDOFF.md` E1) — design constraint F-10 (stream uploads) | PR + `scripts/demo-studio-launch.ts` + full-check item | full check green; prod answers `401` without token |
| 4 | **E2** `/setup` real state (`HANDOFF.md` E2) | PR | screens checked in both modes |
| 5 | **E3** downloads decision (skills only; **skip** Meta Ads MCP; write D16) | DECISIONS entry | — |
| 6 | **E4** clean `PROGRESS.md` | PR | — |
| 7 | Owner-gated (not yours): real links, test ad account, first `live` write, PR #7 decision, `CAPI_TEST_EVENT_CODE` | — | wait for the owner |
| 8 | Deferred on purpose (do not start without the owner): audio transcription/OCR for policy, vision thumbnail picker, reply-capacity rule, OIDC, MinIO, hourly data, 7-day reach for exact frequency, "Purchases via messaging", M08/H01/H02 | — | — |

After every step: update `docs/PROGRESS.md`, add a `D15…` entry in `docs/DECISIONS.md` for any interpretation, run `npx tsc --noEmit`, `npm test`, `node scripts/scan-secrets.mjs`, and `npm run check:full` if `src/core|server|jobs|meta|agents|prisma` changed; release with `HANDOFF.md` D7; verify `/api/health` version; report to the owner in Arabic.

---

## 10. Waiting for the owner (never do these for him)
Meta app + System User token (P0.4) · test ad account (P0.5) · OMS endpoints + token (P0.1/P0.3) · Telegram bot (P0.7) · Drive service account (P0.6) · a model reachable from the server (P0.8) · production `OWNER_EMAIL` and owner account · decision on PR #7 · `CAPI_TEST_EVENT_CODE` for Meta's Test Events · adding you as a collaborator.

---

## 11. Skills and tooling

Skills are instruction files for Claude Code that live on the OWNER'S machine under `~/.claude/skills/`. They are **not** in the repository by default, so the one that matters has been copied here:

| Skill | Purpose | Where you get it |
|---|---|---|
| `zaki-mediabuyer-guard` | The five-place map, red lines, where numbers come from, theme and image rules, build order. **Read it.** If you use Claude Code, copy the folder `docs/skills/zaki-mediabuyer-guard/` to `~/.claude/skills/zaki-mediabuyer-guard/`; if you use another tool, read `docs/skills/zaki-mediabuyer-guard/SKILL.md` as a document | in this repo: `docs/skills/zaki-mediabuyer-guard/SKILL.md` |
| `frontend-design`, `webapp-testing` | Official Anthropic skills (optional helpers for UI and browser testing) | `https://github.com/anthropics/skills` → `skills/frontend-design`, `skills/webapp-testing`. Check each folder's licence before copying; keep them outside the repo; never run their scripts blindly. This is Task E3 |
| `crm-oms-guard`, `zaki-image-prompts`, `daftar-*`, `falak-*`, `game-*`, `godot-*`, `zakiai-studio-art-prompts` | Belong to **other** projects of the owner | Not for this repo. Do not use them here |
| `mediabuyer-art-prompts` | Was planned (GPT image prompts). **Does not exist and is not needed**: the owner chose real licensed photos downloaded by the assistant (`public/brand/CREDITS.md`) | — |
| Meta Ads MCP (e.g. `pipeboard-co/meta-ads-mcp`) | **Do not use.** Business Source License 1.1 (not open source until 2029) and its tools write to Meta, which violates rule 3 | — |

Tooling you need: Node 22, npm, Docker (Postgres on `127.0.0.1:5450` via `docker compose up -d`), ffmpeg/ffprobe on PATH for creative demos, Ollama optional (`npm run demo:agents`). Windows notes in `HANDOFF.md` PART H (Prisma DLL lock, shell quoting).

---

## 12. DO / DON'T cheat-sheet

**DO**
- Read first, change second; match the surrounding code style (comments explain *why* and cite spec sections).
- Put maths in `src/core` with a unit test; screens read through `src/lib/*-view.ts`; keep `MOCK_MODE=1` behaviour working.
- Zod-validate every body; guard every route first; `audit()` every change; Arabic error messages for users.
- Stop and ask the owner whenever a rule in §2 is in tension with a task.

**DON'T**
- Don't merge or touch PR #7. Don't push to `main`. Don't force-push.
- Don't add a page, a theme colour outside tokens, or red for anything but danger.
- Don't run demo scripts or `prisma migrate reset` against production. Don't edit applied migrations.
- Don't weaken a test to make it pass; don't skip hooks/checks; don't disable a CI step.
- Don't put any secret or real customer/order data in the repo (it is public).
- Don't edit other systems (OMS, Workspace, studio).
- Don't tell the owner anything in English.

---

## 13. Report-back template (Arabic, to the owner, after each step)
```
الخلاصة: شو خلص بسطر واحد.
شو انعمل: نقاط قصيرة.
كيف تأكدت: الفحوصات اللي مرّت (والأرقام).
شو لسا ما اشتغل أو ما انفحص: بصراحة.
شو بدي منك: قرار أو مفتاح أو موافقة — أو "ولا شي".
```

*End of brief. The previous assistant has stopped. Everything above is the contract; if reality differs, stop and report.*
