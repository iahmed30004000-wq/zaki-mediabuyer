# INTEGRATIONS — Media Buyer ↔ OMS ↔ Studio ↔ Replies ↔ Drive ↔ Meta

Single source for **how the five systems fit together, what already works, what is missing, and who must do it**.
Written 2026-11-04 from a read-only study of the four code bases (nothing outside this repo was changed).
Rule zero (CLAUDE.md): **numbers are computed by code (`src/core`)**; no customer data (name / phone / address / message text)
ever goes to a model; Telegram can only pause; money approval is on the website only; `META_WRITE_MODE` stays `dry_run`
until a test ad account passes. **Never paste a token into chat or the repo — the owner puts it in Coolify.**

Repos (each system has its own folder, git, DB and deploy — nothing is shared at runtime):

| System | Folder | Git remote | Stack |
|---|---|---|---|
| Media Buyer (this) | `Documents\zaki-mediabuyer` | `iahmed30004000-wq/zaki-mediabuyer` (public) | Next 14 · Prisma · Postgres, worker |
| OMS | `Documents\Zaki-OMS\oms` | `MKory18/Zaki-ai-CRM` | Next · Prisma · `/api/v1` systems door |
| Studio («استوديو المحتوى») | `Pictures\المشروع` | `MKory18/zakiai-studio` | FastAPI + vanilla JS, runs on the owner's PC |
| Replies («سيستم 7») | `Documents\AIresponse-work\AIresponse` | its own `.git` | Next 14 · Prisma · pgvector, worker |

## 1. The map (who talks to whom, who starts the call)

```
 Meta ──(read: insights, objects; write only through ChangeSet, dry_run)── Media Buyer ──(Telegram: reports, «اوقف»)
   ▲  CAPI: purchase/confirmed events (event id oms-<order>-<status>)           │  ▲
   │                                                                             │  │ GET /api/v1/capacity (Bearer)        ┌──────────┐
   └────────────────────────── identifiers (in memory, hashed) ◄── POST /capi/identifiers ─┐                                  │ Replies  │
                                                                                 │  │                                       └──────────┘
 OMS ── GET /api/v1/orders/attribution · /products · POST /capi/identifiers ◄────┘  │
                                                                                    │ studio pulls: /api/vidpattern/ad-performance, /queue (+claim,+result)
 Studio ── Drive «Zakiai/<product>/<VP-id>/6-نهائي/<VP-id>.mp4» (owner OAuth) ──► Drive ──(service account, READ ONLY)──► Media Buyer
 Media Buyer ── Drive «المنتجات/<code>/01_inbox → 02_ready → excluded» (service account, Editor): manual drop, rename + move there only
```

Who starts: Media Buyer pulls from OMS, Replies, Meta, Drive. The **studio always initiates** toward Media Buyer (the PC may be off):
it pulls performance + the request queue, and (later) posts launch requests. Media Buyer never calls the studio.

## 2. State matrix (verified in code on 2026-11-04)

| Link | Media Buyer side | Other side | Verdict |
|---|---|---|---|
| Meta read | ✅ sync, rules, truth | — | needs `META_SYSTEM_USER_TOKEN` (owner, P0.4) |
| Meta write | ✅ ChangeSet, `dry_run` | — | stays `dry_run` until test ad account passes (P0.5) |
| OMS orders | ✅ adapter expects `GET /api/v1/orders/attribution` | ❌ **route does not exist** (BACKLOG RV60) | **OMS work, §4.1** |
| OMS CAPI identifiers | ✅ adapter expects `POST /api/v1/capi/identifiers` | ❌ **does not exist** | **OMS work, §4.1** |
| OMS products + cost | ✅ adapter wants `unit_cost_usd, delivery_fee, return_fee, cod_fee_pct, stock_days` | ⚠️ route exists but without cost fields (withheld on purpose), ignores `?fields=` | **OMS work, §4.1** |
| OMS web attribution | ✅ uses `ad_id` / naming | ❌ web orders keep only `?c=CODE` → campaign. No fbclid / fbp / fbc / utm / ad / adset | **OMS + storefront work, §4.1** |
| Drive (MB own tree) | ✅ `intakeDrive` | — | needs service account + `DRIVE_PRODUCTS_FOLDER_ID` (owner, P0.6) |
| Drive (studio tree) | ✅ **new** `src/jobs/studio-intake.ts` (read only) | ✅ studio already uploads (`drive_sync.py`) | needs owner to share «Zakiai» + `DRIVE_STUDIO_FOLDER_ID` |
| Studio performance feed | ✅ `/api/vidpattern/ad-performance` (+ alias `/api/v1/vp/performance`) | ✅ `crm.py` calls it | ready once tokens exist |
| Studio request queue | ✅ GET queue, claim, result (**result now accepts the studio's body shape**) | ✅ `queue_worker.py` | ready |
| Studio launch requests | ❌ `POST /api/v1/vp/launch-requests` missing (HANDOFF task E1) | ✅ `launch.py` calls it | **MB work, E1** |
| Studio product-market / failure-reasons / library | ❌ not served | ✅ studio calls `/product-market`, `/failure-reasons` | **MB work (follow-up)** |
| Replies capacity | ✅ **new** `src/adapters/replies.ts` + `src/jobs/replies.ts` + alert + scale freeze | ✅ `GET /api/v1/capacity` exists (scope `capacity.read`) | needs token minted for system `mediabuyer` |
| Replies ad signals | ❌ not consumed (no contract yet) | ❌ no ad-level aggregate | **Replies work, §4.3 (new feature)** |
| Replies quality score («تقييم الردود») | — | ❌ no reply rating exists | **Replies work, §4.3 (new feature)** |

## 3. What this change added in Media Buyer (all read-only toward other systems)

1. **Replies capacity** — `src/core/replies.ts` (pure verdict), `src/adapters/replies.ts` (strict zod, rejects unknown fields so a
   customer field can never slip in), `src/jobs/replies.ts` (`replies.sync`, every 15 min).
   Verdict (spec 9.3 / 9.8 / T2.4): **down** (no answer) · **stale** (>2 h) · **behind** (unanswered > 50) · **slow** (median first reply > 30 min).
   Any of them → one `Freeze{kind:"scale"}` per *active message ad set* (`parsedObjective = MSG`), reason prefixed `replies:`; lifted the moment it is good again.
   Website campaigns are never touched. It only stops **raising**; it never pauses or lowers. Limits are the setting `replies.limits`.
   An alert (`alert.replies`, two readings in a row) tells the owner. `/api/health` → `links.replies`.
2. **Studio Drive intake** — `src/jobs/studio-intake.ts` (`creative.intake.studio`, every 15 min). Walks `Zakiai/<product>/<VP-id>/6-نهائي`,
   takes the **highest `-vN`** of each script (a hook copy `-hK` is its own script), runs the same `processVideo` as every intake
   (probe · MD5 duplicate check · `CR#####` · policy guard · thumbnails) with `source="studio"`, `sourceRef=<VP id>`. **Never renames, moves or deletes**
   in the studio tree. An unknown product folder (`kama` ≠ `TRF01`) is skipped, said once a day, and retried — fix it by adding an alias to the product in Settings.
3. **Studio queue result** accepts both `{result:{…}}` (contract) and `{status:"draft", draft:{…}}` (what `queue_worker.py` posts).
4. Env: `DRIVE_STUDIO_FOLDER_ID`, `REPLIES_BASE_URL`, `REPLIES_TOKEN` are now passed to `app` and `worker` in `docker-compose.prod.yml`.

Why no copy of studio videos into the MB Drive tree: a service-account-created file would be owned by the service account and has no storage
quota on a normal Gmail (the studio's own plan rejected service accounts for the same reason). The organized view of videos is the registry
(`/creatives`): one `CR#####` name on Meta = in the registry; the studio keeps its own tree. See DECISIONS D15.

## 4. Work orders for the other systems

Each of these lands in **another repository** → one session per repo, one task at a time, branch only, owner merges. Do not touch Media Buyer from there.

### 4.1 OMS (`Zaki-OMS\oms`) — the biggest gap

Files found: `src/app/api/v1/**` (the door), `src/lib/v1/system-token.ts` (`V1_SCOPES` at ~181, `requireSystemToken` ~310, error envelope `lib/v1/door.ts:120`),
`src/lib/order-state.ts`, `src/lib/product-cost.ts`, `src/lib/public-order.ts`, `components/landing/OrderForm.tsx`.

1. **Scopes.** Add to `V1_SCOPES` (+ Arabic labels `V1_SCOPE_AR`): `orders.attribution.read`, `capi.identifiers`, `products.economics.read`.
2. **`GET /api/v1/orders/attribution?updated_since=ISO&cursor=`** → `{items:[…], next_cursor}`. Item = exactly `OmsOrder` in `src/adapters/oms.ts` of Media Buyer
   (`order_id, product_code(=Product.sku), country, channel, ad_id, adset_id, campaign_id, ad_name, landing_page, status, *_at, order_value, collected, currency, is_fake, capi_ref`).
   Amounts as decimal **strings**; JOD has 3 decimals. **No name / phone / address anywhere** (Media Buyer refuses phone-looking values).
   Status mapping (proposal — the engineer must confirm with the owner; priority top to bottom):
   `returned` = `shippingStatus ∈ {RETURNED, RETURN_REQUESTED}` · `delivered` = `{DELIVERED, PARTIALLY_DELIVERED}` · `shipped` = `{SHIPPED, OUT_FOR_DELIVERY, FAILED_DELIVERY}` ·
   `canceled` = `confirmationStatus ∈ {REJECTED, CANCELLED}` or shipping `CANCELLED` · `confirmed` = `CONFIRMED` · else `new`.
   `confirmed_at ← confirmedAt`, `delivered_at ← deliveredAt`, `returned_at ← returnedAt`. `collected ← collectedAmount` (partial deliveries) else null.
   Paging by `updatedAt` + id cursor; rate limit as the other v1 routes; token → company (never from the request).
3. **`POST /api/v1/capi/identifiers`** body `{refs:[…]}` → `{items:[{ref, phone_e164, fbc, fbp, ctwa_clid, …}]}` per the `CapiIdentifiers` schema in `oms.ts`.
   `capi_ref` is an **encrypted reference** the OMS mints per order; decrypt `ctwaClidEnc` / `psidEnc` and read the phone from `Customer` **in memory only**; POST so nothing sits in a URL or a log; never logged.
4. **`GET /api/v1/products`**: honour `?fields=` and add `aliases, unit_cost_usd` (from `lib/product-cost.ts` average cost per unit, USD), `price_options`, `stock_days`, `delivery_fee` (from `DeliveryFee`),
   `return_fee`, `cod_fee_pct`, behind the new scope `products.economics.read` (the existing `products.read` keeps hiding cost). Where the OMS has no return fee / COD % per product, return `null` — **do not invent** — and tell the owner to fill them in Media Buyer's product settings.
5. **Web-order attribution (the real hole).** Today the landing/storefront keep only `?c=CODE`. Capture at the page: `fbclid`, `_fbc`, `_fbp` cookies, `utm_*`, and the ad/adset ids if the ad URL carries them
   (`{{ad.id}}`, `{{adset.id}}` URL parameters — set in Meta's URL parameters, see 4.5); store on `Order` (new columns; `fbc/fbp` encrypted like `ctwaClidEnc`); expose `ad_id` / `adset_id` in (2).
   Without this, web orders attribute only to a **campaign**, and Media Buyer labels every ad-level number «تقدير». Landing fork: `Documents\zaki-storefront` has no `/api/v1` and no capture either — decide which one is production.
6. **Token for Media Buyer.** Settings → Apps → «توكنات الأنظمة» (UI hard-codes `system:'replies'`; the API `POST /api/settings/system-tokens` accepts `system:"mediabuyer"`). Scopes: the three above + `orders.read`. Expiry 90 days (put the date in the owner's calendar). **The owner creates it; plaintext shown once; goes only into Coolify `OMS_TOKEN`.**
7. **Double-CAPI decision (owner).** The OMS already sends server CAPI (`TrackingPixel`, `CustomConversion`, `lib/conversions/*`, event_id from conversion+order, fbc/fbp not sent) and fires the browser pixel.
   Media Buyer's `capi.send` uses event id `oms-<order>-<status>`. If both send the same moment on the same pixel, Meta counts two. **Recommended:** Media Buyer is the only server sender for Purchase/confirmed (it has the mature-order truth); switch the OMS `CustomConversion` for that pixel off *when* Media Buyer goes live with `CAPI_TEST_EVENT_CODE`, and keep the browser pixel. Verify with Events Manager test events before switching.

Acceptance (copy into the OMS PR): contract tests with the exact JSON; a 401/403/429 test per scope; a test that **no customer field** is in any answer; migrations reviewed; no secrets in logs.

### 4.2 Studio (`Pictures\المشروع`) — small

Already done there (contrary to the older contract text): OAuth device-flow Drive (scope `drive.file`, `gdrive.py`), queue + worker (`drive_sync.py`), final upload `Zakiai/<product>/<stable id>/6-نهائي/<script_id>.mp4` after station 10 approval, SHA-256 de-dup, never deletes.
Needed:
1. **Product code = OMS code.** `brief.product_code` must be the OMS `sku` (`TRF01`), plus `ops_product_id`, `ops_store_id`; otherwise add the alias in Media Buyer (works, but every new product needs a manual alias).
2. **Share the Drive root.** The owner shares «Zakiai» with the service-account e-mail (Viewer). The owner copies the folder id → Coolify `DRIVE_STUDIO_FOLDER_ID`. (`status()` in `drive_sync.py` already knows `folder_url`.)
3. **Sidecar (nice to have, not blocking):** `<script_id>.json` next to the mp4 with hook/angle/dialect/pattern/duration/script — then Media Buyer can tag the registry (`hook`, `angle`, `dialect`) for the learning loop. Use public Drive `properties`, not private `appProperties` (the other account cannot see those).
4. **Confirm** `CRM.base_url` points to `https://mediabuyer.zakiai.io` and the two tokens are in the secret store: `crm_token` (scope `vp:read`) and `crm_token_launch` (`vp:launch`). Mint them in Media Buyer Settings → Studio link. **The studio side was not readable in this study — VERIFY it is configured.**
5. Product facts live in `products/*.json` (`kama`, `vara`) — price/offer/guarantee are empty there; the OMS owns prices. Nothing to copy by hand.

### 4.3 Replies («سيستم 7») — capacity works today; evaluation is new

Facts: webhooks only; comments are stored but **not** auto-answered (manual, Meta approval pending); AI answers DMs (Messenger, Instagram, WhatsApp, Telegram). `/api/v1/*` door with hashed Bearer tokens and scopes; the `mediabuyer` system has the single scope `capacity.read`; every outbound payload passes a PII guard.

1. **Now (no code):** mint a token for system `mediabuyer`, scope `capacity.read`, in Replies' integrations; owner puts `REPLIES_BASE_URL` and `REPLIES_TOKEN` in Coolify. Check `GET /api/v1/capacity` returns `{unanswered, first_response_p50_min, by_channel, at}` with `at` as an ISO date-time **with offset** (Media Buyer rejects anything else, and any extra field).
2. **«الردود لازم تتقيم» — new feature in Replies (separate task, own repo):**
   - *Capacity* (Media Buyer already judges it): unanswered, first-response p50, by channel.
   - *Quality* (does not exist today; nearest signals are `HandoffReason` COMPLAINT / LOW_CONFIDENCE / AI_FAILURE / REPEATED_FAILURE and `AIUsageLog`): a rule-based, local score per conversation (handoff yes/no · customer repeated the question · human edited the AI draft · order drafted → confirmed). Computed **inside Replies**; only aggregates leave.
   - *Ad signals:* new scope `ads.read` and `GET /api/v1/ad-signals?since=` → per `ad_id` per day **counts only**: `conversations_started, first_response_p50_min, unanswered, handoffs_by_reason, orders_drafted, orders_confirmed`, buckets under 5 suppressed. `ad_id` comes from `AttributionTouch.adId` (Messenger `referral.ad_id`; WhatsApp `source_id` + `ctwa_clid`) — a real Meta ad id, joins straight to Media Buyer's `Ad.metaId`. Use the existing PII guard + strict schema.
   - Then Media Buyer adds the consumer (adapter + a column in the ad card + a rule «محادثات كتير · طلبات قليلة» from SPEC 344). **Not built here on purpose: there is no contract yet.**
3. **P0.2 (capture the ad id from the first message)** already exists in Replies (`normalizer.ts`) and flows through the OMS (`ad_id`). It only reaches Media Buyer once §4.1 (2) exists.
4. **Meta conflicts to check, not assume:** is Replies using the **same Meta App ID** as Media Buyer? Webhook callbacks are per *app*, so only one system can own the page webhook of an app. Media Buyer uses **no** webhook (it reads), so the safest setup is **a separate Meta App for Media Buyer** (ads permissions, System User) and leave Replies' app alone. Also: the same WhatsApp number/page connected to both Replies and the OMS inbox = two replies to one customer (Replies `docs/INTEGRATIONS.md:44`).

### 4.4 Drive layout (one picture)

```
Zakiai/                                  ← studio, owner's Drive (OAuth drive.file). Shared Viewer → service account. READ ONLY for Media Buyer.
  <product folder>/                        (folder name = studio product name, e.g. kama)
    VP-kama-109/                           (stable id, no -vN)
      6-نهائي/  VP-kama-109-v1.mp4, -v2.mp4 …   ← Media Buyer takes the highest vN
المنتجات/                                ← Media Buyer, service account Editor. Manual drops only.
  <product>/01_inbox → 02_ready | excluded         (renamed to {PRODUCT}_CR#####_{md5[0:4]}.mp4, nothing deleted)
```
Registry = truth: `CreativeAsset(crCode, md5, source, sourceRef=VP id, driveFileId)`. Meta ad name = `CR#####…` (spec 5.1). The studio's performance feed rebuilds the studio-style name from the registry (D7), so the studio keeps learning per script.

### 4.5 Meta

- Media Buyer: System User token (`ads_read` now; `ads_management` only for the test account), API **v24.0**. Replies: classic Login + page tokens (graph v21). The OMS: ad-account tokens for spend sync (encrypted). Three independent credentials; if the OMS also syncs spend, **two systems read the same ad account — that is fine (read), but only Media Buyer may write**.
- To get `ad_id` / `adset_id` on web orders (4.1 item 5) the ads need **URL parameters**: `ad_id={{ad.id}}&adset_id={{adset.id}}&campaign_id={{campaign.id}}`. Media Buyer's launch builder must add them when it creates ads. **VERIFY against the Meta Marketing API docs for v24.0 before writing the field** (CLAUDE.md: no guessing endpoints/fields).

## 5. Go-live order for these links (owner does the credentials, in Coolify only)

0. Owner account + `OWNER_EMAIL` first (HANDOFF / ONBOARDING §10). Nothing below before that.
1. **Replies capacity** (lowest risk, read-only): token `capacity.read` → `REPLIES_BASE_URL`, `REPLIES_TOKEN`. Check `/api/health` → `links.replies:true`; next 15-min tick shows `replies.sync` ok in job runs.
2. **Studio Drive**: share «Zakiai» → `DRIVE_STUDIO_FOLDER_ID` (+ `GOOGLE_SERVICE_ACCOUNT_JSON` once for both Drive trees). Add aliases for each studio product. Next tick: videos land in `/creatives` as «بانتظار / جاهز» with `CR#####`.
3. **OMS**: only after §4.1 is merged and deployed in the OMS: mint the token → `OMS_BASE_URL`, `OMS_TOKEN` → `MOCK_MODE=0` per the SOP in HANDOFF. Check truth numbers against the OMS's own attribution screen on a few orders by hand.
4. **Meta read** (`META_SYSTEM_USER_TOKEN`), then the test ad account, then (separately, with the owner) `live` writes. `CAPI_TEST_EVENT_CODE` first; switch off the OMS conversions for the same pixel only after the test events match.
5. **Studio tokens**: mint `vp:read` + `vp:launch`, put them in the studio's secret store; the studio's first pull of `/api/vidpattern/ad-performance` returns rows only once ads carry the studio-style name (D7).

## 6. How to test each link without secrets

- Replies: unit tests `tests/replies.test.ts` (verdicts, strict schema, token header, 503 = error not zero). Live: `curl -H "authorization: Bearer $REPLIES_TOKEN" $REPLIES_BASE_URL/api/v1/capacity` from your own shell, never in chat.
- Studio tree: `tests/studio-contract.test.ts` (`vpIdOfFile`, `latestVersions`). Live: put a test mp4 named `VP-<code>-1-v1.mp4` under a test `Zakiai/<product>/VP-<code>-1/6-نهائي`.
- OMS: contract tests in the OMS PR; in Media Buyer the existing adapter tests use fixtures (`src/adapters/fixtures.ts`).

## 7. VERIFY (not confirmed from code)

- Whether the studio has `CRM.base_url`, tokens and Drive connected on the owner's PC (its `settings.json` was not read).
- Whether any OMS `CustomConversion` is enabled on the live pixel; whether Replies and Media Buyer use the same Meta App ID; Meta app-review status; which pages are subscribed.
- OMS return fee / COD % per product (not found); `docs/OMS-DOOR-V1.md` is referenced in the OMS but not in its repo.
- `{{ad.id}}` style URL parameters and the exact field for URL tags in v24.0.
- Studio product folder naming (`kama` vs `TRF01`) in the real Drive.
