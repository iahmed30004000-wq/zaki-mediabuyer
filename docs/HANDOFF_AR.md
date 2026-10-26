# تقرير تسليم — الميديا باير (Zaki Media Buyer)

> **لمين:** أي وكيل أو مطوّر بيكمّل الشغل (مثلاً GLM). اقرأ هالملف كامل قبل أي تعديل.
> **التاريخ:** 27/10/2026 · **آخر commit بالفرع:** `03a4f2a` (feat(alerts): instant alerts to Telegram) · **النسخة على الموقع:** `27faea8`.

---

## 0. بأول دقيقتين

1. المرجع الوحيد للمتطلبات: `docs/SPEC.md`. القرارات اللي بتخالف أو بتفسّر الـ SPEC: `docs/DECISIONS.md` (D1–D14). التقدم: `docs/PROGRESS.md`. القواعد للجلسة: `CLAUDE.md`. دليل المالك: `README.md`. نتيجة الفحص الشامل: `docs/FULL_CHECK.md`. عقد الاستوديو: `docs/STUDIO_DATA_CONTRACT_AR.md`.
2. **كل شي على ميتا لهلأ تجريبي** (`META_WRITE_MODE=dry_run`): ولا كتابة حقيقية انعملت على ميتا أبداً. الكتابة الحقيقية بتصير بس بعد فحص على حساب إعلاني تجريبي (P0.5).
3. **الرد على المالك بالعربي بس** (أردني/سوري بسيط)، **ولا كلمة إنجليزي بالكلام معه** — أسماء الأدوات بحروف عربية (جيت هب، كوليفاي، ميتا، تيليجرام، درايف). الكود والحقول إنجليزي عادي.
4. المالك بيحب: الشغل تلقائي شغلة شغلة لحد ما تخلص كاملة، بلا أسئلة، ودمج تلقائي ونشر تلقائي.

---

## 1. النظام بجملة

مدير إعلانات ميتا لتجارة الدفع عند الاستلام (سوريا والأردن). **القرار على حقيقة الطلبات من الـ OMS** (مؤكد ومُسلَّم)، مش على Purchase ميتا. الأمان تلقائي (إيقاف وتخفيض)، وأي صرف أو إنشاء بموافقة المالك من الموقع، **وأبداً من تيليجرام**. الوكلاء (موديلات) بيفسّروا ويكتبوا بس؛ **الكود بيحسب كل رقم**.

**نظام لحاله:** مجلده وgit تبعه وقاعدة بياناته ومنفذه. ولا شي مشترك وقت التشغيل مع الـ OMS ولا Zaki Workspace ولا الاستوديو. («كل واحد يضل ع حالو»).

---

## 2. وين عايش

| الشي | القيمة |
|---|---|
| المجلد المحلي | `C:\Users\LOQ\Documents\zaki-mediabuyer` |
| جيت هب | `https://github.com/iahmed30004000-wq/zaki-mediabuyer` — **عام**. الفرع اللي بنشتغل عليه: `feat/structure-and-themes`، والدمج لـ `main` |
| الموقع | `https://mediabuyer.zakiai.io` · الصحة: `/api/health` (فيها `version` = أول 7 من commit البناء) |
| الصورة | `ghcr.io/iahmed30004000-wq/zaki-mediabuyer:main` (عامة، بلا أسرار) و `:sha-xxxxxxx` |
| كوليفاي | `https://coolify.zakiai.io` ← مشروع «Zaki Media Buyer» (`eytxdpy4siokvtnvqmwvavf4`) ← production (`gfzddlrnxdd9grbwh3apaqsh`) ← خدمة `mediabuyer` (`wqsoxkdltpwmcqudnqgybom9`). Docker Compose من `docker-compose.prod.yml`: `app` + `worker` + `db` (Postgres 16) + أقراص `mediabuyer_db` و `mediabuyer_storage` |
| المحلي | Postgres بـ Docker (`mediabuyer-db`) على `127.0.0.1:5450` · الموقع `3140` |
| أنظمة جنبه (للقراءة بس) | الـ OMS: `Documents\Zaki-OMS\oms` · Workspace: `Documents\zaki-workspace` · الاستوديو: `C:\Users\LOQ\Pictures\المشروع` |

---

## 3. التقنيات

Next.js 14 (App Router) · TypeScript · Tailwind 3 · Prisma 5 · Postgres 16 · vitest · zod · jose · bcryptjs · decimal.js · exceljs · driver.js · lucide-react · sharp · ffmpeg/ffprobe (بالصورة). عميل ميتا خاص (`src/meta/client.ts`) مع `facebook-nodejs-business-sdk` v24 **كمرجع للحقول بس**. مشغّل مهام على قاعدة البيانات بدل BullMQ (D3). تخزين ملفات محلي (`STORAGE_DIR`) بدل MinIO (D5). دخول خاص بدل OIDC (D4).

---

## 4. التشغيل المحلي

```
docker compose up -d                 # Postgres على 5450
npm install
npx prisma migrate deploy
npm run dev                          # http://localhost:3140
npm run worker                       # العامل: كل المهام المجدولة
```
`.env` (مش بالمستودع) فيه مفاتيح مولّدة محلياً. أهم مفتاحين:
- `MOCK_MODE=1` ← كل الشاشات على بيانات تجريبية ثابتة (`src/lib/mock/data.ts`). `MOCK_MODE=0` ← الشاشات بتقرا القاعدة. **رجّعه 1 بعد أي تجربة** (هيك كان دايماً).
- `AUTH_REQUIRED=0` ← بلا دخول محلياً، والمتصل «demo-owner» (مالك تجريبي؛ ما بيقدر يعمل دعوات أو توكنات).
- الموديل المحلي: Ollama على الجهاز (`INTERNAL_MODEL_BASE_URL`، `qwen3:4b-instruct-2507-q4_K_M`). بلاه الوكلاء بيكمّلوا بكلام الكود.

---

## 5. قواعد ما بتنكسر

**المال والأمان**
- الكود بيحسب كل رقم (`src/core`). الموديل بيفسّر بس، ما بيلمس ميتا، وما بيشوف توكن. أي جملة من الوكيل فيها رقم بتنشال حيث الرقم ممنوع.
- كل تغيير على ميتا = ChangeSet: اقتراح ← تجربة ← موافقة ← تنفيذ ← تحقق ← متابعة ← رجوع (`src/server/changes.ts`). ولا كتابة على ميتا من برّا هالمسار.
- الأمان تلقائي حسب المستوى. الزيادة والإنشاء بموافقة من الموقع. **ولا موافقة من تيليجرام** («اوقف» بس).
- تغيير مصدره «وكيل» **بيستنى إنسان دايماً** مهما كان المستوى.
- كل حملة/إعلان بينشأ **Paused**، بينقرأ من ميتا وبينقارن بالقالب حقل حقل (`src/core/verify.ts`)، وبعدها بس بيتشغّل.
- `safety_net` و `test_campaign` و `connect_asset` و `above_cap`: المالك بس.
- **أي حقل أو endpoint لميتا: تأكد من التوثيق أو من SDK v24 قبل ما تكتبه. ولا تخمين.** (مثال: `spend_cap` للحساب بينكتب بالدولار وبينقرا بالسنت؛ مبالغ القواعد بالسنت؛ الميزانيات بالسنت.)

**الخصوصية والأسرار**
- ولا بيانات زبون (اسم/هاتف/عنوان) لأي موديل ولا بأي سجل. الهاتف بيمر بكود CAPI بس، بينعمل له hash بالذاكرة وبينرمى.
- **ولا مرة تكتب أو تلصق توكن أو كلمة سر** — المالك بيحطهم بإيده بكوليفاي. المستودع عام: ولا سر ولا بيانات حقيقية.
- لا تحذف ملفات درايف أبداً.

**الواجهة (السلاسة أولاً)**
- خمس أماكن + الإعدادات (`src/lib/nav.ts`). ولا صفحة جديدة بلا ما تنحط بمكان موجود (D1).
- كل رقم بشارة مصدره (ميتا · حقيقي · تقدير) ومعه «ليش؟» (`src/lib/glossary.ts`، `components/mb/num.tsx`).
- كل صفحة إلها «شو هاي الصفحة / الخطوة الجاية / فرجيني» (`src/lib/guide.ts`).
- الألوان من التوكنات بس (`src/lib/themes/palettes.ts` ← `npm run themes:css`). **الأحمر للخطر بس.**
- الزخرفة بأربع أماكن بس (الباب · الفاضي · القائمة · الشريط)، أبداً ورا رقم أو جدول.
- ولا تمرير أفقي على 375px.

**قبل أي commit:** `npm test` و `npx tsc --noEmit` (و `node scripts/scan-secrets.mjs`).

---

## 6. الهيكل

| المجلد | شو فيه |
|---|---|
| `src/core/` | **المنطق الصافي** (بلا قاعدة بيانات): الحاسبة `economics.ts` · التسمية `naming.ts` · النضج · القواعد `rules.ts` · الاستقلالية `autonomy.ts` · ChangeSet `changeset.ts` · القوالب `templates.ts` · التحقق `verify.ts` · الاختبارات `experiments.ts` · CAPI `capi.ts` · سلامة الحساب `account-safety.ts` · السلّم `scale.ts` · الخطة `plan.ts` · الأسبوعي `weekly.ts` · التعب `fatigue.ts` · شبكة ميتا `safety-net.ts` · التشخيص `diagnosis.ts` · التنبيهات `alerts.ts` · السياسات `policy.ts` |
| `src/server/` | خدمات بقاعدة البيانات: `changes.ts` (قلب التنفيذ) · `launch.ts` · `safety-net.ts` · `settings.ts` (إعدادات بنسخ) · `auth.ts` · `team.ts` · `audit.ts` · `crypto.ts` · `api-token.ts` |
| `src/jobs/` | مهام العامل: سحب ميتا · الحقيقة · القواعد · السلّم · الإبداعات · الرفع · CAPI · سلامة الحساب · التقارير · التعب · التنبيهات |
| `src/agents/` | الوكلاء: المخطط M03 · الكاتب M07 · الاستشاري M10 · المحلل M02 · المراقب M01 · المعدّ M04 · الحارس M05 · الاستراتيجي M06 |
| `src/gateway/` | بوابة الموديلات (داخلي/خارجي، سقوف، فلتر خصوصية بيرفض أي هاتف أو توكن) |
| `src/meta/` | عميل ميتا · حقول القراءة · الكتابة (dry_run/live) · رفع الفيديو |
| `src/adapters/` | الـ OMS · درايف · تيليجرام · `fixtures.ts` (ميتا والـ OMS الوهميين) |
| `src/ops/backup.ts` | النسخ الاحتياطي والاسترجاع المنطقي |
| `src/io/` | تصدير Excel · استيراد ملف مدير الإعلانات |
| `src/lib/` | بيانات الشاشات (`*-view.ts`، `source.ts`)، التنقل، الدليل، الثيمات |
| `src/app/` | الصفحات (`(app)/{page,ads,decisions,creatives,reports,settings,guide}`، `setup`، `login`، `offline`) والـ API |
| `worker/index.ts` | الجدولة كلها (مكتوبة بأول الملف) |
| `scripts/` | تجارب القبول `demo-*.ts` · `full-path.ts` · `full-check.ts` · النسخ · مسح الخصوصية · الأيقونات |

---

## 7. النشر (تلقائي بالكامل)

1. `git push origin feat/structure-and-themes`.
2. افتح طلب دمج لـ `main`. **ملاحظة:** `gh` على هالجهاز مسجّل بحساب `MKory18` وما بيشوف المستودع. الطريقة اللي اشتغلت: من كروم المالك (مسجّل بـ `iahmed30004000-wq`) افتح
   `https://github.com/iahmed30004000-wq/zaki-mediabuyer/compare/main...feat/structure-and-themes?quick_pull=1&title=…&body=…`
   وابعت النموذج بـ JS: `[...document.querySelectorAll('button[type=submit]')].find(x => /Create pull request/.test(x.textContent)).form.requestSubmit(...)` (الضغط العادي ما بيسجّل لما نافذة كروم مصغّرة).
3. `.github/workflows/image.yml`: npm ci ← tsc ← vitest ← فحص الأسرار ← بناء الصورة وتشغيلها مع Postgres ← **دمج الطلب لحاله** ← نشر الصورة ← نداء كوليفاي (`restart?latest=true` بسر `COOLIFY_TOKEN`) ← **بينجح بس لما `/api/health` يرد بـ `version` هالبناء**.
4. تأكد: `curl https://mediabuyer.zakiai.io/api/health` ← `version` تغيّر، وصفحة Actions خضرا.
5. الصورة بتشغّل `prisma migrate deploy` قبل الموقع، فالترحيلات بتمشي لحالها.

---

## 8. قاعدة البيانات

10 ترحيلات، **كلها إضافة بس (ولا DROP)**: `phase1_init` · `studio_contract` · `phase2_guard` · `phase3_creatives` · `phase4_builder` · `phase5_lessons` · `team_invites` · `creative_requests` · `import_batches` · `alert_state`.

**كيف تضيف ترحيل** (لأنه `prisma migrate dev` ما بيشتغل بلا تفاعل):
```
# عدّل prisma/schema.prisma ثم:
npx prisma format
mkdir prisma/migrations/<YYYYMMDDHHMMSS>_<name>
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://…@127.0.0.1:5450/mb_shadow" --script > prisma/migrations/<…>/migration.sql
npx prisma migrate deploy
npx prisma generate      # ← أوقف سيرفر التطوير أول (ويندوز بيقفل ملف المحرك)
```
تأكد إنه الملف ما فيه `DROP`. التعليقات بالـ schema بـ `///` بس.

---

## 9. الفحص

| الأمر | شو بيعمل | الحالة |
|---|---|---|
| `npm test` | 197 اختبار بـ 23 ملف | ✅ |
| `npx tsc --noEmit` | الأنواع | ✅ |
| `node scripts/scan-secrets.mjs` | ولا سر بالكود | ✅ |
| `npm run check:full` | **الفحص الشامل (SPEC 17.4)** — 16 بند، بيكتب `docs/FULL_CHECK.md` | ✅ 16/16 |
| `npm run check:backup` | نسخة ← استرجاع بقاعدة فاضية ← مقارنة كل جدول | ✅ |

بنود الفحص الشامل (كل واحد سكربت بـ `scripts/`): التحضير · **المسار الكامل** (`full-path.ts`: فيديو ← … ← حدث CAPI) · الأمان (`demo-guard`) · الإطلاق والسلامة (`demo-launch`) · شبكة ميتا (`demo-safety-net`) · السلّم (`demo-phase5`) · **التنبيهات** (`demo-alerts`) · CAPI (`demo-capi`) · الإبداعات (`demo-creatives`) · التعب والطابور (`demo-fatigue`) · الوكلاء (`demo-agents`) · النسخ · مسح الخصوصية · الأسرار · الاختبارات · الأنواع.

> **انتبه:** السكربتات بتكتب بالقاعدة المحلية وبتتراكم بياناتها. السكربتات الحالية بتنظّف بقاياها قبل ما تبلّش؛ أي سكربت جديد لازم يعمل نفس الشي.

---

## 10. شو تمّ (مختصر)

| المرحلة | المحتوى |
|---|---|
| الهيكل والشكل | 5 أماكن + الإعدادات · 4 ثيمات (إزنيق · المرصد · مدينة الغروب بصور حقيقية · وُضوح) · كل الصور حقيقية مرخّصة (`public/brand/CREDITS.md`) · الدليل جوّا الموقع |
| 1 | الحاسبة (مثال 17.1 حرفياً) · سحب ميتا والأرشيف · الـ OMS والحقيقة والإسناد · التقرير الصباحي · التصدير · الدخول والأدوار والتدقيق · البوابة |
| 2 | محرّك القواعد · ChangeSets · المستويات · الإيقاف الكامل · منع اللوب · «اوقف» من تيليجرام |
| 3 | الإبداعات: درايف · MD5 · الترقيم · التسمية · قاموس السياسات · الإطارات المرشحة · الرفع لميتا · استلام من الاستوديو |
| 4 | البنّاء من القوالب (43 تحسين OPT_OUT بالاسم) · التحقق بعد الإنشاء · الاختبارات · CAPI · صحة الإسناد · سلامة الحساب |
| 5 | السلّم (المستوى 2) · المخطط والكاتب والاستشاري · الأسبوعي والشهري وسجل الدروس |
| 6 | تطبيق قابل للتثبيت · الفحص الشامل · نسخ يومي واسترجاع · README عربي |
| بعدها | الإعدادات الحقيقية · الفريق بدعوة · السجل · تعب الإبداع وطابور الاستوديو · شبكة الأمان على ميتا · الوكلاء M01/M02/M04/M05/M06 · الاستيراد · **التنبيهات الفورية على تيليجرام** |

---

## 11. شو ضايل — أربع مهام جاهزة للتنفيذ

### 11.1 الاستوديو: طلبات الإطلاق + حقائق المنتج (أولوية 2 و 3 بالعقد)
**المطلوب:** المسارات اللي كود الاستوديو بيناديها حرفياً (العقد §4.2 #2–5):

| المسار | الصلاحية | ملاحظة |
|---|---|---|
| `POST /api/v1/vp/launch-requests` | `vp:launch` | `multipart`: `video` (حتى 500MB، مهلة 600 ث) + `meta` (JSON). الرد فوراً `200 {request_id, status: "received"}` والفحص بالخلفية |
| `GET /api/v1/vp/launch-requests/{id}` | `vp:read` | `{request_id, status, reason, error_code, ops_url, …ids ميتا}` |
| `POST /api/v1/vp/launch-requests/{id}/cancel` | `vp:launch` | قبل الموافقة بس، وإلا `409 {code: "cannot_cancel"}` |
| `GET /api/vidpattern/product-market?product&country` | `vp:read` | السعر من `ProductEconomics` والباقي إذا متوفر. اسم بديل: `/api/v1/vp/products/{id}/facts` |

**مراجع بكود الاستوديو (قراءة بس):**
- `C:\Users\LOQ\Pictures\المشروع\launch.py`: `build_meta` (سطر ~178، حقول `meta` كاملة: vp_id · mode · country · framework · checksum_sha256 · script_text · captions_srt · hook_line …) · `send` (~236: بيتوقع `request_id` و `status` من القائمة) · `refresh` (~263) · `cancel` (~282) · رسائل الأخطاء (~93–102: ولا redirect؛ `{code, message}`).
- `contracts/vp-ops.v1.yaml`: `LaunchRequest` (~68) · الحالات `received, preparing, awaiting_approval, launched, rejected, failed` (+ `cancelled` من طرف الاستوديو) · رموز الأخطاء (~36: unauthorized, forbidden, not_found, duplicate_request, invalid_meta, checksum_mismatch …) · `mode: active | test`.
- `crm.py`: `FACTS_PATH = "/api/vidpattern/product-market"` وطريقة قراءة الرد (~440–520) — طابق الشكل اللي بيتوقعه.

**القواعد:**
- منع التكرار على `(vp_id, mode)`: نفس الطلب ← نفس الرد `200`؛ طلب مختلف بنفس المفتاح ← `409 duplicate_request`.
- `sha256` ما طابق ← `422 checksum_mismatch`.
- **ولا توكن استوديو بيوافق على صرف.** الطلب بيمشي بنفس الاستلام (`processVideo` بـ `src/jobs/creative-intake.ts`) ← الحارس ← رفع موقوف ← الإطلاق بيستنى موافقة المالك بالموقع.
- ربط الحالات: `received` (انحفظ) ← `preparing` (فحص/رفع) ← `awaiting_approval` (فيه ChangeSet إطلاق بانتظار المالك) ← `launched` (انتنفّذ وتحقق) / `rejected` (القاموس أحمر أو المالك رفض، مع `reason`) / `failed`.
- جدول جديد `LaunchRequest` (العقد §6): request_id · vp_id · mode · status · reason · error_code · checksum · ids ميتا · crCode · changeSetId. ترحيل إضافة بس.
- الواجهة: ما في صفحة جديدة — كل شي بـ «الإبداعات» (وارد ← بانتظارك…).
- الاختبارات: خادم وهمي بيبعت `multipart` حقيقي، منع التكرار، `checksum_mismatch`، وتوكن `vp:launch` بياخد `403` على أي موافقة.
- الموجود هلأ للاستوديو: `GET /api/vidpattern/ad-performance` · `/api/v1/vp/performance` · `POST /api/v1/vp/creatives` (creative.ready) · طابور الطلبات `/api/vidpattern/queue` + claim + result.

### 11.2 صفحة «جهّز النظام» بالحالة الحقيقية
`src/app/setup/page.tsx` لسا بيقرا `SETUP_STEPS` من `src/lib/mock/data.ts`. لازم يعرض حالة كل بند P0 الحقيقية: استعمل `loadEditView()` (`src/lib/settings-view.ts`، فيها `links` من آخر نجاح لكل مهمة) + هل في سقوف ومنتجات وصفحات وصفحات هبوط. بوضع `MOCK_MODE=1` بيضل على التجريبي.

### 11.3 تنزيلات وعدنا فيها بالخطة الأولى
- من `github.com/anthropics/skills`: مهارتي `frontend-design` و `webapp-testing` (لمساعد Claude Code؛ إذا الشغل صار على GLM ممكن ما تلزم).
- نسخة مرجعية من «Meta Ads MCP» المفتوح بمجلد `vendor/` — **قراءة بس**: ما بيشتغل ولا بيشوف توكن. (اختياري.)

### 11.4 تنظيف `docs/PROGRESS.md`
أسطر قديمة: A6 «⏳ صور» (الصور خلصت كلها، شوف `CREDITS.md`) · T2.3 «M04 و M01 = الجاي» (خلصوا) · سطر «الجاي» بيذكر «قواعد ميتا الآلية» (خلصت = P7.4).

---

## 12. مؤجل بقصد (بدّه سيرفر أو نظام تاني)

- **تفريغ الصوت + قراءة النص على الفيديو** لفحص السياسات (T3.3) — موديلات على السيرفر. هلأ القاموس على نص الإعلان والسكربت.
- **اختيار الغلاف بوكيل بيشوف صور** (M06) — هلأ 6 إطارات مرشحة من ffmpeg.
- **قدرة الرد** (T2.4) — بتستنى نظام الردود.
- **دخول بفيسبوك (OIDC)** و **تخزين MinIO** — قرارين D4 و D5.
- **التكرار الحقيقي للتعب**: هلأ من الصفوف اليومية (بيقلّل). الأدق: سحب `reach` بنافذة 7 أيام من ميتا.
- **الأرقام الساعية**: ما في سحب ساعي؛ «ما في تسليم» و«قفزة الساعة» تقريبية على اليومي.
- **«Purchases via messaging»** بعد ~50 حدث/أسبوع · M08 الجمهور · H02 التعليقات · H01 محلل الأسماء القديمة.

---

## 13. بيستنى المالك

| البند | شو | وين |
|---|---|---|
| P0.4 | ربط ميتا: تطبيق + مستخدم نظام + رمز | كوليفاي: `META_SYSTEM_USER_TOKEN` ← `MOCK_MODE=0` |
| P0.5 | حساب إعلاني تجريبي لأول تجربة `META_WRITE_MODE=live` | |
| P0.3 / P0.1 | الـ OMS: `OMS_BASE_URL` · `OMS_TOKEN` + حفظ fbc/fbp/الهاتف مع كل طلب + نقطة `POST /api/v1/capi/identifiers` (D9) | |
| P0.7 | تيليجرام: `TELEGRAM_BOT_TOKEN` · `TELEGRAM_OWNER_CHAT_ID` · `TELEGRAM_ALLOWED_CHAT_IDS` | |
| P0.6 | درايف: `GOOGLE_SERVICE_ACCOUNT_JSON` · `DRIVE_PRODUCTS_FOLDER_ID` | |
| — | موديل على السيرفر: `INTERNAL_MODEL_*` أو `EXTERNAL_MODEL_*` | |
| — | **طلب الدمج #7 «Feat/oms live adapter»** من حساب `MKory18` — مفتوح وبيستنى قراره. ما حدا لمسه | |
| — | تفعيل CAPI لأول مرة بأداة Test Events: `CAPI_TEST_EVENT_CODE` | |

---

## 14. أشياء لازم تعرفها (تعلمناها بالطريقة الصعبة)

- **ويندوز + Prisma:** `prisma generate` بيفشل `EPERM` إذا في سيرفر Next شغّال (حتى `next start` يتيم على منفذ تاني). أوقفه أول.
- **`next build` بيكتب فوق `.next` تبع سيرفر التطوير** ← رجّع شغّل سيرفر التطوير بعد أي بناء.
- عامل الخلفية (PWA) ما بيشتغل بالمتصفح المدمج؛ جرّبه بكروم على `next start`.
- أول فتح لصفحة بالتطوير ممكن يرجّعك على `/` (سباق البناء الأول) — افتحها مرة تانية.
- الكتابة على ميتا بوضع dry_run بتعطي أرقام بديلة فريدة `dry_<ref>_<8hex>` — ما تفترض `dry_campaign` ثابت.
- `spend_cap` للحساب: كتابة بالدولار، قراءة بالسنت. مبالغ قواعد ميتا (`spent`) بالسنت. الميزانيات بالسنت.
- `requireCapability` بيستعمل `cookies()` — ما بيشتغل من سكربت؛ السكربتات بتنادي دوال `src/server` مباشرة أو الـ route handlers بـ `new Request(...)`.
- ملفات عربية: اكتب بـ UTF-8. أوامر bash فيها `'` جوّا heredoc ممكن تنكسر — أسهل تكتب الملفات مباشرة.
- السكربتات التجريبية بتعدّل القاعدة المحلية؛ بقايا التشغيلات القديمة ممكن تخرّب تشغيلة جديدة (صار مع «أفضل 3 إعلانات» ومع «متوسط نسبة التأكيد») — نظّف بأول السكربت.
- مستوى الحساب: 2 بعد 14 يوم من أول ChangeSet على الحساب؛ 3 مطفي.
- العامل بيستعمل `runOnce(job, slot)` = قفل بقاعدة البيانات؛ ولا مهمة بتتكرر لنفس الخانة الزمنية.

---

## 15. أوامر سريعة

```
npm run dev                     # الموقع
npm run worker                  # العامل
npm test && npx tsc --noEmit    # قبل أي commit
npm run check:full              # الفحص الشامل
npm run db:backup               # نسخة هلأ
npm run demo:pipeline           # بيانات تجريبية بالقاعدة المحلية
curl https://mediabuyer.zakiai.io/api/health
```
