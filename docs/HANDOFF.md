# HANDOFF — Zaki Media Buyer («الميديا باير»)

**For:** the next agent (e.g. GLM) or developer who continues this project.
**Written:** 27 Oct 2026 · **Branch:** `feat/structure-and-themes` · **Last code commit:** `03a4f2a` · **Live version:** `27faea8`
**Rule zero:** read this file from top to bottom BEFORE touching anything. Follow it literally. When something here does not match what you see in the code, STOP and report it to the owner — do not guess.

Arabic terms are kept in Arabic on purpose: they are the exact words the owner and the screens use. Do not translate them in the UI.

---

## Table of contents

- PART A — Rules you must never break (read twice)
- PART B — Talking to the owner
- PART C — The project in facts
- PART D — Standard operating procedures (SOP) — do every step, every time
- PART E — The four remaining tasks, step by step
- PART F — Knowledge you need (the project "skill", Meta units, Arabic vocabulary)
- PART G — Deferred on purpose / waiting for the owner
- PART H — Traps we already fell into (and how to avoid them)
- PART I — Quick reference

---

# PART A — Rules you must never break

These come from `CLAUDE.md`, `docs/SPEC.md` section 3 and the owner's own instructions. Breaking one of them can spend real money, leak customer data or break the live site.

### A1. Money and Meta
1. **Every number is computed by code** (`src/core/*`, with `decimal.js`). A model (agent) only explains or words things. Never let a model's output decide a number, a budget, a status or an id.
2. **Every change to Meta goes through a ChangeSet** (`src/server/changes.ts`: `propose → simulate → approve → execute → verify → follow-up → rollback`). Never call `MetaClient.post` from anywhere else.
3. **Safety is automatic, spending is not.** Pause / reduce may run on their own (by account level). Any raise, resume, new ad or new campaign waits for a person **on the site**. **Never from Telegram** (Telegram can only «اوقف»).
4. **A change whose source is `agent` always waits for a person**, whatever the level (`src/server/changes.ts`, the `p.source !== "agent"` guard). Do not remove that guard.
5. **Everything is created PAUSED**, read back from Meta, compared field by field with the template (`src/core/verify.ts`), and only then switched on.
6. **`META_WRITE_MODE` stays `dry_run`.** No real write to Meta has ever happened. Only the owner switches it to `live`, and only after a test on a test ad account (P0.5). Never change this value, not locally, not in Coolify, not in code defaults.
7. **Every Meta field / endpoint must be checked against the official docs or the official SDK v24** (`node_modules/facebook-nodejs-business-sdk/src/objects/*.js`) before you write it. No guessing. Units: budgets in cents; ad-rule money (`spent`) in cents; ad account `spend_cap` WRITTEN in dollars (float) and READ in cents.
8. Owner-only kinds at every level: `safety_net`, `test_campaign`, `connect_asset`, `above_cap`. Do not lower them.

### A2. Privacy and secrets
9. **No customer data (name / phone / address) ever reaches a model, a log, a report, an alert or the database.** The only exception: CAPI code reads identifiers from the OMS at send time, hashes them in memory and drops them (`src/jobs/capi.ts`).
10. **Never write, paste or invent a token, key or password** — not in code, not in `.env.example`, not in chat, not in commits. The owner enters secrets himself in Coolify.
11. **The GitHub repository is PUBLIC.** No secrets, no real customer data, no real order data in the repo — ever.
12. **Never delete Google Drive files.** Move only, and only inside the media buyer's own `01_inbox / 02_ready / excluded` folders. Never rename or move files inside the content studio's `Zakiai/` tree.

### A3. Data
13. **Migrations are additive only.** No `DROP`, no column rename, no type change of an existing column. Check every generated `migration.sql` for the word `DROP` before applying.
14. **Never run destructive commands on the production database.** No `prisma migrate reset`, no `db push --force-reset`, no manual `DELETE` in Coolify's terminal.
15. Never edit an existing migration folder. A fix is a new migration.

### A4. Git, deploy and other systems
16. Work only on branch `feat/structure-and-themes`. **Never push to `main` directly. Never force-push. Never rewrite history.**
17. Every merge to `main` deploys to the live site automatically (PART D7). Treat every pull request as a production release.
18. **Do not touch other systems' folders or repositories:** the OMS (`Documents\Zaki-OMS\oms`), Zaki Workspace (`Documents\zaki-workspace`), the content studio (`C:\Users\LOQ\Pictures\المشروع`). Read them only when a task says so. Each system keeps its own deploy method — do not "unify" anything.
19. **Do not touch pull request #7 («Feat/oms live adapter», from account `MKory18`).** It waits for the owner's decision. Do not merge, close, rebase or comment on it.
20. Never commit files you did not write in this session unless the task says so. Never commit `.env`.

### A5. The screens
21. Five places + settings only (`src/lib/nav.ts`): `اليوم` · `الإعلانات` · `القرارات` · `الإبداعات` · `التقارير` + `الإعدادات`. **Never add a new page.** A new feature goes into an existing place (a tab, a section, a sheet, a card). Also existing: `/guide` (`الدليل`), `/setup` (`جهّز النظام`), `/login`, `/offline`.
22. Every number shows its source badge (`ميتا` · `حقيقي` · `تقدير`) and «ليش؟» (`components/mb/num.tsx` + `src/lib/glossary.ts`).
23. Colours only from theme tokens (`src/lib/themes/palettes.ts` → `npm run themes:css`). **Red is for danger only.** Decoration only in the four places (door · empty state · sidebar · strip) — never behind a number or a table.
24. No horizontal scroll at 375 px width on any screen.
25. All user-facing text is Arabic (simple Levantine), short, with the reason and how to undo. Codes (CR00147, TRF01, LP1, ids) stay LTR (`dir="ltr"`).

### A6. When unsure
26. If a task, a file or a result does not match this document: **stop, do not improvise, tell the owner in Arabic what you found and what you suggest.** It is always better to stop than to break.

---

# PART B — Talking to the owner

- The owner is Ahmad («أحمد»). **Every word you say to him is Arabic** (simple Jordanian/Syrian). **Not one English word** in what he reads — he was explicit: «كل كلامك إلك بالعربي، بدون أي كلمة إنجليزي». That includes short progress lines.
- Tool and product names in Arabic letters: جيت هب، كوليفاي، ميتا، تيليجرام، درايف، جي إل إم.
- Describe code things in words, not file names. Give a link only when he must click it.
- He wants autonomy: «بشكل تلقائي بتخلص شغلة شغلة لا تنتقل لشغلة غير لما تخلص الي قبلها بشكل كامل، لا تسألني عن اشي، اعمل الأفضل والأنسب، دمج تلقائي لجيت هاب وديبلوي تلقائي لكوليفاي». So: finish one task completely (code + tests + docs + merge + deploy + verify live) before starting the next, and do not ask him for decisions you can make safely. **But** anything in PART A that needs him (secrets, `live` mode, PR #7, money) — you stop and tell him.
- At the end of each task: a short Arabic report — what was done, how it was verified, what is not done, what waits for him.
- Files written for him to read (like `README.md`) are in Arabic. Code, comments, commit messages and this handoff are English.

---

# PART C — The project in facts

### C1. What it is
A Meta ads manager for cash-on-delivery e-commerce (Syria `SY`, Jordan `JO`). It decides on **the OMS truth** (confirmed / delivered, mature orders only), not on Meta's Purchase count. Safety rules act automatically; spending waits for the owner. Agents (LLMs) explain and draft only.

### C2. Where things are
| Thing | Value |
|---|---|
| Local folder | `C:\Users\LOQ\Documents\zaki-mediabuyer` (Windows 11; Git Bash and PowerShell available) |
| GitHub | `https://github.com/iahmed30004000-wq/zaki-mediabuyer` — public. Work branch `feat/structure-and-themes`, release branch `main` |
| Live site | `https://mediabuyer.zakiai.io` — health: `/api/health` (JSON with `version` = first 7 chars of the build commit) |
| Image | `ghcr.io/iahmed30004000-wq/zaki-mediabuyer:main` (public, no secrets) and `:sha-xxxxxxx` |
| Coolify | `https://coolify.zakiai.io` → project «Zaki Media Buyer» `eytxdpy4siokvtnvqmwvavf4` → env `gfzddlrnxdd9grbwh3apaqsh` → service `mediabuyer` `wqsoxkdltpwmcqudnqgybom9` (Docker Compose from `docker-compose.prod.yml`: `app`, `worker`, `db` Postgres 16, volumes `mediabuyer_db`, `mediabuyer_storage`) |
| Local DB | Docker container `mediabuyer-db`, Postgres 16 on `127.0.0.1:5450` (`docker-compose.yml`) |
| Local site | `http://localhost:3140` |
| Local model | Ollama on the owner's machine, `INTERNAL_MODEL_NAME=qwen3:4b-instruct-2507-q4_K_M` |

### C3. Stack
Next.js 14 App Router · TypeScript (strict) · Tailwind 3 · Prisma 5 · Postgres 16 · vitest · zod · jose · bcryptjs · decimal.js · exceljs · driver.js · lucide-react · sharp · ffmpeg/ffprobe (in the image). Job runner on the database (no Redis/BullMQ, decision D3). Local file storage under `STORAGE_DIR` (no MinIO yet, D5). Own login (no OIDC yet, D4).

### C4. Documents (read them)
| File | What |
|---|---|
| `docs/SPEC.md` | THE requirements. Section numbers are cited everywhere (e.g. "spec 6.5") |
| `docs/DECISIONS.md` | D1–D14: every place the code differs from or interprets the spec |
| `docs/PROGRESS.md` | Task table, phase by phase |
| `docs/FULL_CHECK.md` | Evidence of the last full check (spec 17.4), 16/16 |
| `docs/STUDIO_DATA_CONTRACT_AR.md` | The contract with the content studio (Arabic) |
| `README.md` | The owner's guide (Arabic): run, update, roll back, back up, link Meta, change level |
| `CLAUDE.md` | The short rules |

### C5. Folder map
| Folder | Contents |
|---|---|
| `src/core/` | **Pure logic, no database.** `economics.ts` (the calculator, spec 17.1/17.2 exact) · `naming.ts` · `maturity.ts` · `rules.ts` · `autonomy.ts` · `changeset.ts` · `templates.ts` · `verify.ts` · `experiments.ts` · `capi.ts` · `account-safety.ts` · `scale.ts` · `plan.ts` · `weekly.ts` · `fatigue.ts` · `safety-net.ts` · `diagnosis.ts` · `alerts.ts` · `policy.ts` · `roles.ts` · `studio-contract.ts` · `creative.ts` · `telegram-command.ts` |
| `src/server/` | Services with the DB: `changes.ts` (the ONLY path to Meta) · `launch.ts` · `safety-net.ts` · `settings.ts` (versioned settings) · `auth.ts` · `team.ts` · `audit.ts` · `crypto.ts` · `api-token.ts` (studio tokens) · `db.ts` |
| `src/jobs/` | Worker jobs: `meta-sync` · `truth` · `rules-run` · `scale-run` · `creative-intake` · `creative-upload` · `capi` · `account-safety` · `morning-report` · `weekly-report` · `fatigue` · `alerts` · `studio-performance` · `runner` |
| `src/agents/` | M03 planner · M07 writer · M10 consultant · M02 analyst · M01 monitor · M04 preparer · M05 guard · M06 strategist |
| `src/gateway/` | The model gateway: internal/external routing, daily/monthly caps, privacy filter (refuses any phone/token/e-mail) |
| `src/meta/` | `client.ts` (safe client) · `read.ts` · `write.ts` (dry_run/live) · `video-upload.ts` |
| `src/adapters/` | `oms.ts` · `drive.ts` · `telegram.ts` · `fixtures.ts` (pretend Meta + pretend OMS for tests/demos) |
| `src/ops/backup.ts` | Logical backup/restore |
| `src/io/` | `export.ts` (Excel) · `import.ts` (Ads Manager CSV/XLSX) |
| `src/lib/` | Screen data loaders (`*-view.ts`, `source.ts`), `nav.ts`, `guide.ts`, `glossary.ts`, `mock/data.ts`, themes |
| `src/app/` | Pages: `(app)/{page,ads,decisions,creatives,reports,settings,guide}`, `setup`, `login`, `offline`, `manifest.ts`; API under `src/app/api/` |
| `src/components/` | UI: `ads/`, `creatives/`, `settings/`, `setup/`, `shell/`, `mb/` (Num, Panel, Section, ChangeCard…), `ui/` (Button, Input, Select, Dialog, Sheet, Toast…) |
| `worker/index.ts` | The whole schedule (documented at the top of the file) |
| `scripts/` | Acceptance demos `demo-*.ts`, `full-path.ts`, `full-check.ts`, backup scripts, privacy sweep, secrets scan, icons |
| `tests/` | 23 vitest files, 197 tests |
| `prisma/` | `schema.prisma` + 10 migrations (all additive) |

### C6. Environment variables (names only — never values)
`DATABASE_URL` · `ENCRYPTION_KEY` · `AUTH_SECRET` · `MOCK_MODE` · `AUTH_REQUIRED` · `OWNER_EMAIL` · `APP_URL` · `META_API_VERSION` · `META_SYSTEM_USER_TOKEN` · `META_WRITE_MODE` · `META_DATASET_ID` · `CAPI_TEST_EVENT_CODE` · `OMS_BASE_URL` · `OMS_TOKEN` · `TELEGRAM_BOT_TOKEN` · `TELEGRAM_OWNER_CHAT_ID` · `TELEGRAM_ALLOWED_CHAT_IDS` · `TELEGRAM_WEBHOOK_SECRET` · `GOOGLE_SERVICE_ACCOUNT_JSON` · `DRIVE_PRODUCTS_FOLDER_ID` · `INTERNAL_MODEL_BASE_URL` · `INTERNAL_MODEL_NAME` · `INTERNAL_MODEL_KEY` · `EXTERNAL_MODEL_BASE_URL` · `EXTERNAL_MODEL_KEY` · `EXTERNAL_MODEL_NAME` · `EXTERNAL_MODEL_USD_PER_1K` · `PRIVACY_MODE` · `STORAGE_DIR` · `TZ`.
Local `.env` is gitignored. In production every value lives in Coolify (secrets are Coolify-generated `SERVICE_PASSWORD_*`).
- `MOCK_MODE=1` → every screen shows the fixed demo data from `src/lib/mock/data.ts`. `MOCK_MODE=0` → screens read the database. **The local `.env` must be left at `MOCK_MODE=1`** after any test (it always was).
- `AUTH_REQUIRED=0` (local only) → no login, the caller is a stand-in owner `demo-owner` (`demo: true`) that cannot invite members or create tokens.

---

# PART D — Standard operating procedures

Do these exactly. Commands are for Git Bash in `C:\Users\LOQ\Documents\zaki-mediabuyer` unless noted.

### D1. Start of every session
```
cd /c/Users/LOQ/Documents/zaki-mediabuyer
git status                      # must be clean, branch feat/structure-and-themes
git branch --show-current       # → feat/structure-and-themes
git fetch origin
git merge --no-edit origin/main # main only ever contains merged PRs of this branch
docker ps --format "{{.Names}}" | grep mediabuyer-db || docker compose up -d
npx prisma migrate deploy
npx tsc --noEmit                # baseline: no output
npm test                        # baseline: 23 files, 197 tests pass
grep -n "^MOCK_MODE" .env       # must be MOCK_MODE=1
```
If any baseline fails BEFORE you changed anything: stop and report to the owner. Do not "fix" unknown failures.

### D2. Making a change
1. Read every file you will touch, fully, before editing. Match the surrounding style (comments explain *why*, cite spec sections, English).
2. Pure logic goes in `src/core/` with a unit test in `tests/`. DB work goes in `src/server/` or `src/jobs/`. Screens read through a loader in `src/lib/*-view.ts`.
3. Keep demo mode working: every loader returns demo data (or `null` → the page keeps its demo view) when `process.env.MOCK_MODE === "1"`. Every API route that writes returns `{ ok: true, demo: true }` in mock mode **after** the capability check.
4. Every API route: `requireCapability(...)` (site users) or `requireToken(req, scope)` (studio tokens) **first**; zod-validate the body; `errorResponse(e)` / `contractResponse(e)` in `catch`; `audit(...)` for every change.
5. After the change:
   ```
   npx tsc --noEmit
   npm test
   node scripts/scan-secrets.mjs      # → "Secret scan clean"
   npx next lint                       # 0 errors (one known warning in src/lib/i18n is fine)
   ```
6. If you touched `src/core`, `src/server`, `src/jobs`, `src/meta`, `src/agents` or `prisma/`: also run the full check (D5).

### D3. Database migration (only when a task needs a new table/column)
`prisma migrate dev` does NOT work non-interactively here. Use exactly:
```
# 1. edit prisma/schema.prisma (comments with /// only; additive only)
npx prisma format
# 2. stop the dev server (Windows locks the Prisma engine DLL)
# 3. create the migration folder with a timestamp later than the last one (last: 20261026160000_alert_state)
mkdir -p prisma/migrations/20261027100000_<snake_name>
DBURL=$(grep ^DATABASE_URL .env | cut -d= -f2- | tr -d '"')
SHADOW=$(echo "$DBURL" | sed 's#/mediabuyer?#/mb_shadow?#; s#/mediabuyer$#/mb_shadow#')
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW" --script > prisma/migrations/20261027100000_<snake_name>/migration.sql
# 4. READ the file. It must contain only CREATE TABLE / CREATE INDEX / ALTER TABLE ... ADD COLUMN. No DROP. No ALTER COLUMN TYPE.
grep -c DROP prisma/migrations/20261027100000_<snake_name>/migration.sql   # → 0
npx prisma migrate deploy
npx prisma generate      # if EPERM: a node process still holds the DLL — see H1
```
The shadow database `mb_shadow` already exists in the local container. If it is missing: `docker exec mediabuyer-db psql -U mediabuyer -d postgres -c "CREATE DATABASE mb_shadow"`.
The production image runs `prisma migrate deploy` on start, so migrations reach production by themselves after merge.

### D4. Switching the local site to real data (for browser checks) — and back
```
sed -i 's/^MOCK_MODE=1/MOCK_MODE=0/' .env
# restart the dev server (npm run dev), check, then ALWAYS:
sed -i 's/^MOCK_MODE=0/MOCK_MODE=1/' .env
grep -n "^MOCK_MODE" .env   # → MOCK_MODE=1
```
Never commit `.env`. Never leave it at `0`.

### D5. The full check (spec 17.4)
```
npm run check:full     # ~4 minutes; writes docs/FULL_CHECK.md
```
Must end with `✓ every item held`. It runs demos against the LOCAL database (they write data; each cleans its own leftovers first). If an item fails: run that single script (listed in `scripts/full-check.ts`) and read its `✗` line. If the failure is caused by leftovers from earlier runs (old demo data), make the script clean its own leftovers at its start — never weaken the assertion. Commit the updated `docs/FULL_CHECK.md`.
If you add a feature that the spec's list covers, add a demo script and an item to `ITEMS` in `scripts/full-check.ts`.

### D6. Checking screens in a browser
- `npm run dev` → `http://localhost:3140`. The first load of a page in dev may land on `/` (first-compile race): load it again.
- Check desktop (≥1280 px) and phone (375×812). On every page run in the console:
  `document.documentElement.scrollWidth > innerWidth + 1` → must be `false`.
- Check both `MOCK_MODE=1` (demo) and `MOCK_MODE=0` (real local data), then return to `1` (D4).
- The service worker (`public/sw.js`) only registers in production mode (`next build && next start -p 3141`) and only in a real Chrome. **After testing production mode, stop that server** (H1).

### D7. Commit, pull request, deploy, verify (the release)
1. Commit on `feat/structure-and-themes`. Message: English, conventional style, body explains what and why, e.g.
   `feat(studio): launch requests from the content studio (contract §4.2 #2–4)`.
   ```
   git add <only your files>
   git status --short        # check nothing unexpected (.env must never appear)
   git commit -F- <<'EOF'
   ...message...
   EOF
   git fetch origin && git merge --no-edit origin/main
   git push origin feat/structure-and-themes
   ```
2. Open a pull request into `main`. The local `gh` CLI is logged in as `MKory18` and **cannot see this repo**. Use the owner's Chrome (logged in as `iahmed30004000-wq`): open
   `https://github.com/iahmed30004000-wq/zaki-mediabuyer/compare/main...feat/structure-and-themes?quick_pull=1&title=<url-encoded title>&body=<url-encoded body>`
   then submit with JavaScript (normal clicks do not register when the Chrome window is minimised):
   ```js
   const s = [...document.querySelectorAll('button[type=submit]')].find(x => /Create pull request/.test(x.textContent));
   s.form.requestSubmit(s);
   ```
   Confirm on `https://github.com/iahmed30004000-wq/zaki-mediabuyer/pulls` that exactly ONE new pull request exists (never create duplicates; if the first attempt seems to fail, check the list before trying again).
3. The workflow `.github/workflows/image.yml` runs by itself: `npm ci` → `tsc` → `vitest` → secrets scan → build the image → start it with Postgres and probe `/api/health` → **merge the pull request itself** → publish the image → call Coolify (`restart?latest=true`, secret `COOLIFY_TOKEN`) → **pass only when `/api/health` reports this build's `version`**.
4. Verify:
   ```
   curl -s https://mediabuyer.zakiai.io/api/health      # "version" must change from the previous value
   ```
   and on `https://github.com/iahmed30004000-wq/zaki-mediabuyer/actions` the latest run must say "completed successfully". New API routes answer `401` without a session (that proves they exist; `404` means they are not deployed).
5. If the run fails: open it, find the failing step, fix forward with a new commit on the branch (the PR updates itself). Never disable a check, never skip tests, never edit the workflow to make it pass.

### D8. Rolling back
- A decision on Meta: «القرارات» → the card → «رجّع» (creates an inverse ChangeSet; a launch is undone by pausing, never deleting).
- A setting: settings are versioned (`restoreSetting`).
- The site: GitHub → the merged PR → "Revert" → it opens a revert PR that goes through D7. Emergency only: in Coolify change the image tag from `:main` to the previous `:sha-xxxxxxx` and restart — and tell the owner.

### D9. Documentation after every task
- `docs/PROGRESS.md`: add or update the task row (status ✅ / جزئي, and how it was verified).
- `docs/DECISIONS.md`: a new `D15`, `D16`… section for any choice that differs from or interprets the spec.
- `README.md` (Arabic, for the owner): only if the owner's way of using the system changed.
- Update the relevant guide text in `src/lib/guide.ts` if a screen gained a feature.

---

# PART E — The four remaining tasks

Do them in this order. Each one ends with D7 (merge, deploy, verify live) and an Arabic report to the owner before the next one starts.

## E1. Studio launch requests + product facts (contract priorities 2 and 3)

### E1.1 Goal
Let the content studio (a Python app on the owner's machine) send a finished video as a **launch request**, follow its status, cancel it before approval, and read a product's commercial facts. The studio code already exists and calls these paths literally; we must answer exactly what it expects. **No studio token can ever approve spending.**

### E1.2 Read first (read-only; do not edit these files)
- `docs/STUDIO_DATA_CONTRACT_AR.md` §4.2–4.5, §6.
- Studio: `C:\Users\LOQ\Pictures\المشروع\launch.py` — constants at the top (`MODES`, `_DONE`, `_CANCELLABLE`, `STATUS_LABEL`), `_call` (~line 80: expects JSON, no redirects, errors as `{code, message}`), `build_meta` (~178), `send` (~236), `refresh` (~263), `cancel` (~282).
- Studio: `C:\Users\LOQ\Pictures\المشروع\contracts\vp-ops.v1.yaml` — schemas `Error`, `LaunchMeta`, `LaunchStatus`, `LaunchRequest`, paths `/api/v1/vp/launch-requests*`, `/api/v1/vp/products/{id}/facts`.
- Studio: `C:\Users\LOQ\Pictures\المشروع\crm.py` — `FACTS_PATH = "/api/vidpattern/product-market"`, `_fetch_cached` (sends `params={"product": code, "country": country}`), `_normalize_market` (~455).
- Ours: `src/app/api/v1/vp/creatives/route.ts` (the existing studio intake by URL — reuse its pattern), `src/server/api-token.ts` (`requireToken`, `ContractError`, `contractResponse`), `src/core/studio-contract.ts` (`VP_ID`, `isVpId`), `src/jobs/creative-intake.ts` (`processVideo`, `IntakeMeta`, `storageDir`), `src/server/launch.ts` (the wizard launch), `src/jobs/creative-upload.ts`.

### E1.3 What the studio sends and expects (verbatim facts)
- `POST /api/v1/vp/launch-requests` — token scope `vp:launch`, `multipart/form-data` with parts:
  - `video`: the MP4 file (filename `<vp_id>.mp4`, content-type `video/mp4`), up to 500 MB, upload timeout 600 s.
  - `meta`: a JSON **string** with: `vp_id`, `product_id` (the OMS product id, a string), `store_id`, `country` (ISO-2, e.g. `SY`), `mode` (`active` | `test`), `framework`, `pattern_id`, `hook_line`, `dialect`, `duration_sec` (45–50), `character_id` (nullable), `script_text`, `captions_srt`, `checksum_sha256` (of the video), optionally `thumbnail` (base64 PNG), and for hook versions `hook_group` + `hook_index`.
  - Expected answer: `200 {"request_id": "...", "status": "received", "ops_url": "...", "reason": null}`. The studio rejects an answer without `request_id` or with a status outside the list below.
- Status list (exact strings): `received`, `preparing`, `awaiting_approval`, `launched`, `rejected`, `failed`, `cancelled`. The studio's own label for each: استُلم · قيد التجهيز · بانتظار موافقتك · انطلق · مرفوض · فشل · أُلغي.
- `GET /api/v1/vp/launch-requests/{id}` — scope `vp:read` — answer `{request_id, status, reason, error_code, ops_url, campaign_id, adset_id, ad_id, landing_page_id}` (nulls allowed).
- `POST /api/v1/vp/launch-requests/{id}/cancel` — scope `vp:launch` — only when status is `received`, `preparing` or `awaiting_approval`; else `409 {"code":"cannot_cancel","message":"..."}`. Answer `200 {request_id, status:"cancelled"}`.
- Idempotency on `(vp_id, mode)`: the studio itself refuses to resend unless the previous request ended (`rejected`/`failed`/`cancelled`). Server side: same `(vp_id, mode)` + same `checksum_sha256` while an earlier request is not ended → answer `200` with **that existing request**; same `(vp_id, mode)` + a different checksum while not ended → `409 {"code":"duplicate_request"}`; an ended earlier request → create a new one.
- Error codes (exact): `unauthorized`, `forbidden`, `not_found`, `duplicate_request`, `invalid_meta`, `video_invalid`, `checksum_mismatch`, `video_too_large`, `already_approved`, `cannot_cancel`, `rate_limited`, `server_error`. Body always `{code, message}` with an **Arabic** `message`. `checksum_mismatch` / `invalid_meta` / `video_invalid` / `video_too_large` → HTTP `422`. No redirects ever.
- `GET /api/vidpattern/product-market?product=<code>&country=<SY|JO>` — scope `vp:read` — a JSON **object**. The studio reads only these keys and treats a missing key as "unknown" (never as "none"): `price` (string, or `{amount, currency}` or `{display}`), `offer_tiers` (array of `{label}` or `{qty, price}`), `guarantee` (string or `{text}`), `country`, `dialect`, `cod` (boolean), `delivery` (`{days_min, days_max, fee, note}`). **Only send keys we really know.** We know: `price` (from `ProductEconomics.price`, currency `USD`), `country` (from `ProductEconomics.market`), `cod: true`, `delivery.fee` (from `ProductEconomics.deliveryFee`). Do NOT send `offer_tiers` or `guarantee` (absent = unknown; an empty list would make the studio write «no offer»). Alias path: `GET /api/v1/vp/products/{id}/facts?country=` (same body; `{id}` is our product code).

### E1.4 Design (decided — implement exactly this)
The studio request **does not launch anything by itself**. It feeds the normal intake, then the owner launches from the wizard as today. The request's status is **derived live** from the records it is linked to:

| Derived status | When |
|---|---|
| `cancelled` | the request was cancelled |
| `failed` | the video could not be processed (intake `broken`), the upload to Meta died (`CreativeAsset.status = "dead"`), or the linked launch ChangeSet ended `failed` |
| `rejected` | the policy guard excluded it (`CreativeAsset.status = "excluded"` or `policyFlag = "red"`), it is a duplicate (`dupOf`), or the owner rejected the linked launch ChangeSet (`state = "rejected"`) — `reason` carries the Arabic reason |
| `launched` | the linked launch ChangeSet is `executed` (fill `campaign_id`, `adset_id`, `ad_id` from its items: `op="create"` items by `objectType`; in dry-run these are `dry_…` stand-ins) |
| `awaiting_approval` | the creative is ready to launch (`metaVideoId` set, status `uploaded`/`ready`) and/or a launch ChangeSet containing it is `pending_approval` |
| `preparing` | the file is stored and the intake ran (asset exists) but not ready yet (e.g. `review` waiting for the owner's yellow-policy approval, or the Meta upload not done) |
| `received` | stored, intake not run yet |

### E1.5 Files to create / change
1. `prisma/schema.prisma` — add (then migrate with D3, name `studio_launch_requests`):
   ```prisma
   /// A launch request from the content studio (contract §4.2 #2–4). It feeds the normal intake; the owner launches
   /// from the wizard. Its status is derived from the creative and the launch change set it is linked to.
   model LaunchRequest {
     id           String    @id @default(cuid())
     vpId         String
     /// active · test
     mode         String
     checksum     String
     /// the stored upload, until the intake took it
     filePath     String?
     crCode       String?
     changeSetId  String?
     /// set when the intake ended badly (broken file) or the request was cancelled
     closedStatus String?
     reason       String?
     errorCode    String?
     /// the meta part as received, minus the thumbnail (no customer data exists in it)
     meta         Json
     createdAt    DateTime  @default(now())
     updatedAt    DateTime  @updatedAt

     @@index([vpId, mode])
     @@index([crCode])
   }
   ```
2. `src/core/studio-launch.ts` (pure, unit-tested):
   - `LaunchMetaSchema` (zod) for the meta JSON: required `vp_id` (must pass `isVpId`), `product_id`, `store_id`, `country` (`/^[A-Z]{2}$/`), `mode` (`"active"|"test"`), `framework`, `pattern_id`, `hook_line`, `dialect`, `duration_sec` (number), `script_text`, `captions_srt`, `checksum_sha256` (`/^[a-f0-9]{64}$/`); optional `character_id` (string|null), `thumbnail` (string), `hook_group` (string), `hook_index` (int).
   - `productCodeOf(vpId: string): string | null` — the second segment of `vp_id` when it matches `/^[A-Z]{3}\d{2}$/` (e.g. `VP-TRF01-0012-v2` → `TRF01`), else `null` (then the route looks it up in `ProductAlias` by alias; if still unknown → `422 invalid_meta` «المنتج مش معروف عند الميديا باير — ضيفه بالإعدادات أو كاسم بديل»).
   - `ENDED = ["rejected","failed","cancelled"] as const`, `CANCELLABLE = ["received","preparing","awaiting_approval"] as const`.
   - `duplicateDecision(existing: {status, checksum} | null, checksum): "new" | "same" | "conflict"` — `null` or ended → `"new"`; same checksum → `"same"`; else `"conflict"`.
   - `deriveStatus(r: {closedStatus, reason, crCode}, asset: {status, policyFlag, policyNote, dupOf, metaVideoId} | null, cs: {state, error} | null): {status, reason}` implementing the table in E1.4 in this priority order: `closedStatus` → cs `executed`/`rejected`/`failed` → asset `dead` (failed) → asset `excluded`/red/`dupOf` (rejected) → asset ready (`metaVideoId` and status in `ready|uploaded`) or cs `pending_approval` (awaiting_approval) → asset exists (preparing) → `received`.
3. `src/server/studio-launch.ts` (DB service):
   - `createLaunchRequest(meta, file, size)`: the dedupe (`duplicateDecision` on the latest request with the same `vpId`+`mode`), then move the temp file to `path.join(storageDir(), "incoming", `${id}.mp4`)` (create the folder), insert the row (`meta` without `thumbnail`), return it.
   - `processPendingRequests()` for the worker: for each request with `filePath != null` and `crCode == null` and no `closedStatus`: call `processVideo(filePath, { productCode, source: "studio", sourceRef: meta.vp_id, originalName: meta.vp_id, texts: { adText: meta.script_text, transcript: meta.script_text, ocrText: meta.captions_srt }, tags: { conceptId: undefined, hookType: undefined, dialect: meta.dialect } })`; on `ready/review/excluded` store `crCode`; on `duplicate` store `closedStatus:"rejected"`, `reason:"نسخة من <dupOf>"`, `errorCode:"duplicate_request"`; on `broken` store `closedStatus:"failed"`, `reason`, `errorCode:"video_invalid"`. Then delete the file and set `filePath:null`. **Never** delete anything on Drive.
     Note: `processVideo` already refuses a duplicate MD5 and an existing `sourceRef`. If `CreativeAsset.sourceRef` already equals this `vp_id` (the same script came earlier by URL), link `crCode` to that asset instead of processing again.
   - `statusOf(request)`: load the asset by `crCode` and the change set by `changeSetId` (or, if none, the latest `ChangeSet` of kind `test_campaign` whose `create` items include a creative named with this `crCode`), run `deriveStatus`, and build the contract body (`ops_url = ${APP_URL}/creatives`).
   - `cancelRequest(id)`: allowed only when the derived status is in `CANCELLABLE`; set `closedStatus:"cancelled"`; if a linked launch ChangeSet is still `pending_approval`, **do not touch it** (the owner decides) — just mark the request. Answer `409 cannot_cancel` otherwise.
4. `src/server/launch.ts` → in `launch()`, right after `propose(...)` returns, link open studio requests: `db.launchRequest.updateMany({ where: { crCode: { in: input.crCodes }, closedStatus: null }, data: { changeSetId: cs.id } })`.
5. Routes (all `export const dynamic = "force-dynamic"`; all `catch (e) { return contractResponse(e); }`):
   - `src/app/api/v1/vp/launch-requests/route.ts` — `POST`: `await requireToken(req, "vp:launch")`; `const form = await req.formData()`; `video = form.get("video")` must be a `File`; `meta = JSON.parse(String(form.get("meta")))` validated by `LaunchMetaSchema` (fail → `ContractError(422, "invalid_meta", "<Arabic>")`); size > 500 MB → `ContractError(422, "video_too_large", "الفيديو أكبر من 500MB")`; stream the file to a temp path (`os.tmpdir()/mb-studio/<uuid>.mp4`) while computing sha256 (`node:crypto` `createHash("sha256")`); mismatch → delete the temp file, `ContractError(422, "checksum_mismatch", "بصمة الملف ما طابقت — ابعته من جديد")`; then `createLaunchRequest` → `NextResponse.json({ request_id, status, reason: null, ops_url })`.
   - `src/app/api/v1/vp/launch-requests/[id]/route.ts` — `GET`: `requireToken(req, "vp:read")`; `404 not_found` if missing; `NextResponse.json(await statusOf(r))`.
   - `src/app/api/v1/vp/launch-requests/[id]/cancel/route.ts` — `POST`: `requireToken(req, "vp:launch")`; `cancelRequest`.
   - `src/app/api/vidpattern/product-market/route.ts` — `GET`: `requireToken(req, "vp:read")`; `product` query is our product code (`/^[A-Z]{3}\d{2}$/`) or an alias (`ProductAlias`); `404 not_found` if unknown; body as in E1.3 (only known keys).
   - `src/app/api/v1/vp/products/[id]/facts/route.ts` — same handler (import a shared function from `src/server/studio-launch.ts`).
   - The middleware already leaves `/api/v1/vp/` and `/api/vidpattern/` open (tokens are checked inside each route) — do not change `src/middleware.ts`.
6. `worker/index.ts` → add a job (document it at the top of the file): `await runOnce("studio.launch", quarter, () => processPendingRequests());` next to `creative.intake`.
7. The screen (no new page): in «الإبداعات», a creative whose `sourceRef` has a `LaunchRequest` shows a small badge «طلب إطلاق من الاستوديو · تست» or «… · منتج شغّال» (map `mode`). Find where creative cards are rendered (`src/components/creatives/creatives-view.tsx`, data from `src/lib/creatives-view.ts`); add the field in the loader and render the badge. Mock mode: no badge.
8. `.env.example` / `docker-compose.prod.yml`: nothing new is needed (uses `STORAGE_DIR`, `APP_URL`). The `incoming` folder lives on the `mediabuyer_storage` volume (both `app` and `worker` mount it — the API stores, the worker processes).

### E1.6 Tests (`tests/studio-launch.test.ts`, pure)
- `LaunchMetaSchema`: a full valid meta passes; a missing `script_text` fails; `mode: "live"` fails; a bad checksum fails.
- `productCodeOf("VP-TRF01-0012-v2") === "TRF01"`; `productCodeOf("VP-kama-109-v2") === null`.
- `duplicateDecision`: `null` → new; ended → new; same checksum → same; other checksum → conflict.
- `deriveStatus`: one case per row of the E1.4 table, plus priority cases (cancelled beats everything; executed beats asset states; red policy → rejected with the policy note as reason).
- In `tests/studio-contract.test.ts` (existing), add: the product-market body never contains `offer_tiers` or `guarantee`.

### E1.7 Demo script `scripts/demo-studio-launch.ts` (then add it to `scripts/full-check.ts` `ITEMS`)
Pattern: copy the structure of `scripts/demo-fatigue.ts` (it creates temporary studio tokens with `newToken()`/`hashToken()` and calls route handlers directly with `new Request(...)`, then deletes the tokens in `finally`). Steps to assert:
1. Make a real 6-second 1080×1920 video with ffmpeg (copy the `ffmpeg` call from `scripts/full-path.ts`), compute its sha256.
2. POST with a `vp:read` token → `403 forbidden`.
3. POST with a wrong checksum → `422 checksum_mismatch`.
4. POST valid (`vp_id` `VP-TRF01-9xxx-v1` with a unique number per run) → `200 received`.
5. POST the same again → `200` with the same `request_id`; POST same `vp_id`+`mode` with another checksum → `409 duplicate_request`.
6. Run `processPendingRequests()` → GET → `preparing` or `awaiting_approval` (dry-run: the upload is not sent, so the creative stays `ready` without a Meta video id → `preparing` is the correct answer in dry-run; say so in the output).
7. Cancel → `200 cancelled`; cancel again → `409 cannot_cancel`.
8. `product-market?product=TRF01&country=SY` → has `price` and `cod: true`, has no `offer_tiers`.
9. Clean up: delete this run's `LaunchRequest` rows and temp files at the end; at the start delete leftovers whose `vpId` starts with `VP-TRF01-9`.
Also verify: a `vp:launch` token gets `401`/`403` on `/api/changes/<id>` (approval) — studio tokens are not site sessions, so it must be `401` from the middleware or `403` from `requireCapability`. Assert it is NOT 200.

### E1.8 Docs
- `docs/PROGRESS.md`: row «S2 — طلبات الإطلاق من الاستوديو + حقائق المنتج» ✅ with how it was verified.
- `docs/DECISIONS.md`: `D15` — the request does not launch by itself; status derived; product facts send only known keys; `product_id` (OMS id) is not used for mapping, the product comes from `vp_id` or `ProductAlias`.
- `docs/STUDIO_DATA_CONTRACT_AR.md`: in the table of §4.2, mark rows 2–5 as implemented (Arabic).

### E1.9 Done when
All tests pass, `npm run check:full` passes with the new item, deployed (D7), and on production `POST /api/v1/vp/launch-requests` and `GET /api/vidpattern/product-market` answer `401` without a token. Report to the owner in Arabic.

---

## E2. «جهّز النظام» (`/setup`) shows the real state

### E2.1 Goal
`src/app/setup/page.tsx` renders `SETUP_STEPS` from `src/lib/mock/data.ts` (fixed `done` flags). With `MOCK_MODE=0` it must show the real state of each prerequisite.

### E2.2 Steps
1. In `src/lib/settings-view.ts` add `export async function loadSetupSteps(): Promise<SetupStep[] | null>` (return `null` when `MOCK_MODE === "1"`). Keep the same 8 keys, titles and `why` texts as `SETUP_STEPS`; compute `done`:
   | key | done when |
   |---|---|
   | `meta` | `META_SYSTEM_USER_TOKEN` is set AND `lastSuccess("meta.sync")` is within the last 3 hours |
   | `oms` | `OMS_BASE_URL` and `OMS_TOKEN` set AND `lastSuccess("oms.sync")` within 3 hours |
   | `tracking` | over the last 7 days, ≥ 80% of `AttributedOrder` (not fake) have `method = "ad_id"` (and at least 10 orders) |
   | `products` | at least one `ProductEconomics` with `price > 0` and `unitCost > 0` |
   | `caps` | every `AdAccount` has `dailyCap > 0` and `monthlyCap > 0` (and at least one account exists) |
   | `telegram` | `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_CHAT_ID` set |
   | `drive` | `GOOGLE_SERVICE_ACCOUNT_JSON` and `DRIVE_PRODUCTS_FOLDER_ID` set |
   | `models` | `modelConnected()` from `@/gateway` |
   Use `lastSuccess` from `@/jobs/runner` and `modelConnected` (dynamic `await import("@/gateway")` as `loadSettingsView` does).
   Update the `how` texts to the production truth, in Arabic: the keys go into **Coolify → the `mediabuyer` service → Environment Variables** (not `.env`); products and caps «من الإعدادات». Keep them short (two lines).
2. In `src/app/setup/page.tsx`: make it `async`, add `export const dynamic = "force-dynamic"`, and `const steps = (await loadSetupSteps()) ?? SETUP_STEPS;`.
3. Do not change `SetupChecklist` (`src/components/setup/setup-checklist.tsx`) except if a text needs it.
4. Check (D6) with `MOCK_MODE=0`: the counter «X من 8 جاهزين» reflects reality (locally: products and caps done if set, Meta/OMS/Telegram/Drive not done, models done when Ollama runs). Return to `MOCK_MODE=1`.
5. Test: put the pure part (`stepsFrom(facts)` taking booleans/numbers and returning the 8 steps) in `src/core/` or keep it in the loader but export a pure helper and test it in `tests/`.
6. Docs: PROGRESS row; no decision needed.

---

## E3. The open-source downloads promised in the first plan

### E3.1 What and why
The first plan promised two official Anthropic skills (`frontend-design`, `webapp-testing`) from `https://github.com/anthropics/skills` (verified: both exist at `skills/frontend-design` and `skills/webapp-testing`; the repo says most skills are Apache-2.0 — confirm in each folder before copying) and a read-only reference copy of an open Meta Ads MCP.

### E3.2 Steps
1. Skills (only useful if the owner keeps using Claude Code; harmless otherwise):
   ```
   git clone --depth 1 https://github.com/anthropics/skills /tmp/anthropic-skills
   # read the licence of each skill folder first (LICENSE file or SKILL.md header); proceed only if Apache-2.0 or similar open licence
   cp -r /tmp/anthropic-skills/skills/frontend-design ~/.claude/skills/
   cp -r /tmp/anthropic-skills/skills/webapp-testing ~/.claude/skills/
   rm -rf /tmp/anthropic-skills
   ```
   Do NOT copy them into the project repository. Do NOT run any script inside them.
2. **Meta Ads MCP: SKIP IT.** The known open project (`pipeboard-co/meta-ads-mcp`) is under the Business Source License 1.1 (not open source until 2029) and its tools write to Meta (create campaigns, update ads). It conflicts with rules A1 (only ChangeSets touch Meta) and A4. Record this as `D16` in `docs/DECISIONS.md` («ما نزّلنا أداة ميتا المفتوحة: رخصتها مش مفتوحة لـ 2029 وفيها أدوات كتابة على ميتا؛ مرجع الحقول هو مكتبة ميتا الرسمية v24») and tell the owner in Arabic.
3. Nothing to deploy for this task except the DECISIONS entry (commit it with E4).

---

## E4. Clean `docs/PROGRESS.md`

Exact edits (read the file first; lines may have moved):
1. Row `A6` («الصور: تنزيل صور مرخّصة بدل برومبتات GPT…»): status `✅ أقنعة · ⏳ صور` → `✅`, and in the last column: «كل الصور حقيقية مرخّصة — `public/brand/CREDITS.md`».
2. Row `T2.3`: status `جزئي` → `✅`; replace «الوكلاء M04 و M01 = الجاي» with «M04 و M01 خلصوا (P7.5)».
3. Row `T2.2`: replace «شبكة الأمان على ميتا نفسها (قواعد ميتا الآلية) = الجاي» with «شبكة الأمان على ميتا = P7.4 ✅».
4. The line starting `**الجاي:**`: keep only what is really next: «متطلبات المالك (P0) ← ربط ميتا الحقيقي وتجربة `live` على الحساب التجريبي (P0.4 · P0.5) · طلب الدمج #7 بقرار المالك». Remove «قواعد ميتا الآلية كاحتياط (10.3)».
5. Rows `T2.4` (reply capacity) and `T3.3` (transcription/OCR) stay `جزئي` — they are deferred on purpose (PART G).
6. Add the rows for E1, E2, E3 after they are done.
Commit as `docs: progress up to date`, then D7.

---

# PART F — Knowledge you need

### F1. The project skill (verbatim essentials of `~/.claude/skills/zaki-mediabuyer-guard/SKILL.md`)
- Reply to the owner in Arabic (simple Jordanian/Syrian), short, non-technical, one example. Code, fields and tables in English.
- The system is standalone: own folder, git, Postgres (`mediabuyer-db`, `127.0.0.1:5450`, compose project `mediabuyer`), app on **3140** (3100 is the OMS and 5440 the Workspace DB on his machine). Nothing shared at runtime.
- The map — five places + settings (never a sixth without the owner):
  | Place | Route | Holds (spec screens) |
  |---|---|---|
  | `اليوم` | `/` | S01 + S12 summary + alerts |
  | `الإعلانات` | `/ads` | S03 tree · S04 item card as a side **sheet** · S05 truth tab · S08 tests tab · «＋ إطلاق» 4-step wizard |
  | `القرارات` | `/decisions` | S07 ChangeSets · S09 rules (read) · «سلّم التكبير» |
  | `الإبداعات` | `/creatives` | S06 as one flow: `وارد ← بانتظارك ← جاهز ← شغّال ← متعب` |
  | `التقارير` | `/reports` | S15 · S10 · S11 · plan · lessons · diagnosis |
  | `الإعدادات` | `/settings` | S02 S12 S09 S13 S16 S17 S18 (links, money, products & pages, levels, agents, import/export, team & audit, look) |
  Also `/guide` (`الدليل`), `/setup` (`جهّز النظام`), the consultant (S14) as a button on every page, the kill switch always in the header.
- Red lines: the code computes every number (spec 17.1/17.2 are tests and must stay exact); decisions on OMS truth with MATURE orders only (`src/core/maturity.ts`); every Meta change a ChangeSet; safety automatic, spending approved on the site, never from Telegram; no customer data to any model; tokens encrypted, never in logs, prompts or the browser; everything created PAUSED and verified; every Meta field checked against the docs.
- Screens: source badge + «ليش؟» on every number; «؟» on every page (what this page is, the next step, «فرجيني» tour via `data-tour` attributes in `src/lib/guide.ts`); theme tokens only, contrast test must pass; decoration in four places only; phone first (no horizontal scroll at 375 px, thumb-size buttons, bottom bar of four + «المزيد»). GTA-style touches are ours: level stars ★★☆ (`LevelStars`), the «تمّت ✓» banner (`useMission`). Never a game name, logo or screenshot.
- Themes: `iznik` (default, light) · `observatory` (dark) · `sunset-city` (dark, real golden-hour photos) · `wudooh` (light, spec 18.1). New palettes must pass `tests/themes-palettes.test.ts`.
- Images: the owner prefers that you **find and download** freely licensed images (CC0 / public domain — The Met Open Access is ideal — Unsplash, Pexels) instead of writing image prompts for him. Ornaments that recolour are drawn in code (SVG → WebP alpha). Art slots are `public/brand/art/<slot>.webp`. Every file gets a row in `public/brand/CREDITS.md`. No faces, people, hands, animals, logos, readable text or calligraphy-as-decoration; nothing from games or films.

### F2. Arabic vocabulary used in the UI (keep these exact words)
| Arabic | Meaning |
|---|---|
| ميتا · حقيقي · تقدير | source badges: Meta number · OMS truth · estimate |
| مستشار · حارس · مكبّر محدود · مدير | autonomy levels 0 · 1 · 2 · 3 (3 is off) |
| وارد ← بانتظارك ← جاهز ← شغّال ← متعب | creative flow: inbox → waiting for you → ready → live → tired |
| بانتظارك · صار تلقائي · السجل | decisions sections |
| رجّع | roll back (button) |
| جرّب · وافق · ارفض | simulate · approve · reject |
| اوقف | pause (the only Telegram command that acts) |
| الإيقاف الكامل | kill switch |
| سلّم التكبير | the scale ladder (+20% per 48 h) |
| شبكة الأمان على ميتا | the safety net (account cap + Meta rule) |
| جهّز النظام | the setup checklist page |
| ＋ إطلاق | the launch wizard |
| ليش؟ | "why?" (opens the formula and source of a number) |
| فرجيني | "show me" (guided tour) |
| تمّت ✓ | the mission-complete banner |

### F3. Meta facts already verified (do not re-guess)
- API version `v24.0`. Insights fields verified against `facebook-nodejs-business-sdk` v24.0.
- Budgets (`daily_budget`, `lifetime_budget`, campaign `spend_cap`) in cents.
- Ad account `spend_cap`: write as float in dollars; read back as cents string. `spend_cap_action: "reset"` resets `amount_spent`.
- Ad rules (`/act_{id}/adrules_library`): `evaluation_spec {evaluation_type: "SCHEDULE", filters:[{field, operator, value}]}`, `execution_spec {execution_type: "PAUSE"}`, `schedule_spec {schedule_type: "SEMI_HOURLY"}`; `spent` value in cents; `entity_type` `AD|ADSET|CAMPAIGN`; `time_preset` `TODAY`…; rule `status` `ENABLED|DISABLED`.
- Creative enhancements: 43 keys opted out by name with `degrees_of_freedom_spec.creative_features_spec.<key>.enroll_status = "OPT_OUT"` (list in `src/core/templates.ts`).
- Resumable video upload: start → transfer → finish, then poll `status.video_status` (`src/meta/video-upload.ts`).
- CAPI: events older than 7 days are refused (we drop them before sending); `event_id` dedupes.

### F4. Core numbers (tests guard them)
- Spec 17.1 truth example → 121.20 · 5.51 · 6.64 · 107.77 · 6.74 · 2.21 (`tests/economics.test.ts`).
- Spec 17.2 estimate → M = 4.16 · T_order = 2.50 · T_confirmed = 3.84 · T_delivered = 5.12.
- Never change `src/core/economics.ts` without the owner; if a test there fails, you broke something.

---

# PART G — Deferred on purpose / waiting for the owner

### G1. Deferred (need a server-side model or another system — do NOT start them)
- Transcribing the video audio + reading on-screen text (OCR) for the policy guard (spec T3.3). Today: the dictionary on the ad text and the studio's script/captions.
- Choosing the thumbnail with a vision model (M06). Today: 6 ffmpeg candidate frames.
- Reply capacity rule (T2.4) — waits for the replies system.
- Facebook login (OIDC, D4) and MinIO object storage (D5).
- 7-day reach from Meta for exact fatigue frequency; hourly insights.
- «Purchases via messaging», M08 audiences, H02 comments, H01 legacy-name analyst.

### G2. Waiting for the owner (never do these yourself)
| Item | What | Where |
|---|---|---|
| P0.4 | Meta app + System User token | Coolify: `META_SYSTEM_USER_TOKEN`, then `MOCK_MODE=0` |
| P0.5 | A test ad account for the first `META_WRITE_MODE=live` test | owner |
| P0.3 / P0.1 | OMS link: `OMS_BASE_URL`, `OMS_TOKEN`; the OMS stores fbc/fbp/phone per order and exposes `POST /api/v1/capi/identifiers` (D9) | owner + OMS project |
| P0.7 | Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`, `TELEGRAM_ALLOWED_CHAT_IDS` | Coolify |
| P0.6 | Drive: `GOOGLE_SERVICE_ACCOUNT_JSON`, `DRIVE_PRODUCTS_FOLDER_ID` | Coolify |
| — | A model on the server: `INTERNAL_MODEL_*` or `EXTERNAL_MODEL_*` | Coolify |
| — | Pull request #7 «Feat/oms live adapter» (from `MKory18`) | owner decides |
| — | First CAPI test via Meta's Test Events: `CAPI_TEST_EVENT_CODE` | owner |

---

# PART H — Traps we already fell into

1. **Windows + Prisma:** `prisma generate` fails with `EPERM … query_engine-windows.dll.node` while any Next server runs (including an orphan `next start -p 3141`). Find it: PowerShell `Get-NetTCPConnection -LocalPort 3140,3141 -State Listen | Select OwningProcess`, check its command line is this project's `next`, stop only that process, retry. Never kill other node processes.
2. **`next build` overwrites `.next` of the running dev server** → after any build, restart the dev server.
3. **Bash heredocs with quotes** inside Python or JS can break the whole command (nothing runs). Prefer writing files directly; keep shell commands simple. Files are UTF-8 (Arabic).
4. **Demo scripts write to the local DB and pile up.** Two failures came from old runs crowding results ("best 3 ads", "product confirm-rate average"). Every new demo must clean its own leftovers at its start, using a unique prefix.
5. **Dry-run stand-in ids are unique** (`dry_<ref>_<8 hex>`). Never assume `dry_campaign`.
6. **`requireCapability` reads cookies** — it fails outside a request. In scripts call the `src/server` functions directly or call route handlers with `new Request(...)` (see `scripts/demo-fatigue.ts`).
7. **First page load in dev may redirect to `/`** — load again.
8. **The in-app browser cannot run service workers**; test the PWA in real Chrome with `next start`.
9. **Creating a pull request twice** — always check the PR list before retrying.
10. **The local `gh` CLI is the wrong account** (`MKory18`) — use the owner's Chrome (D7).
11. **Fatigue frequency** comes from summed daily reach (undercounts) — documented, do not "fix" by inventing numbers.
12. **Account level 2** needs 14 days since the first ChangeSet on that account; level 3 is off. Do not bypass in code.

---

# PART I — Quick reference

```
npm run dev                         # site on :3140
npm run worker                      # all scheduled jobs
npx tsc --noEmit && npm test        # before every commit
node scripts/scan-secrets.mjs       # secrets scan
npm run check:full                  # full check (spec 17.4) → docs/FULL_CHECK.md
npm run check:backup                # backup → restore into a scratch DB → compare
npm run db:backup                   # backup now (STORAGE_DIR/backups/<day>)
npm run demo:pipeline               # demo data into the local DB
npm run demo:agents                 # agents with the local model
curl -s https://mediabuyer.zakiai.io/api/health
```

Worker schedule (Asia/Amman, from `worker/index.ts`): meta.sync every 30 min by day / 2 h at night · meta.final 03:00 · db.backup 02:30 · oms.sync :05 · truth.compute :10 · rules :15 · rules.scale :17 · account.safety :20 · creative.intake / meta.upload / capi.send / alerts.read every 15 min · alerts.send every 5 min · creatives.fatigue 07:30 · analysis and attribution 08:00 · report.morning 09:00 · plan.week Sat 09:30 · creatives.week Sat 09:45 · report.weekly Sat 10:00 · report.monthly 1st 10:00 · safety.month 1st 06:00.

**Last word:** when in doubt, stop and ask the owner — in Arabic.
