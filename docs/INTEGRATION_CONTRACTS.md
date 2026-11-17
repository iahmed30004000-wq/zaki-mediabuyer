# عقود الربط — الميديا باير مع باقي الأنظمة (v1)

> **الحالة:** مقترحة، مكتوبة من الميديا باير. ما انغيّر أي نظام تاني: القراءة بس من كودهم المحلي.
> **القاعدة:** الأنظمة بتحكي مع بعض بعقود مكتوبة ومرقّمة. النسخة اللي اننشرت **ما بتنكسر**: بنضيف حقول اختيارية بس. حقل انشال أو تغيّر اسمه أو نوعه = `v2`.
> **أبداً:** اسم زبون أو رقمه أو عنوانه ما بيطلع من الـOMS ولا من Zaki Pages لأي موديل. توكنات الإعلانات ما بتوصل لأي موديل. الأسرار بـ Coolify بس (وقريباً من شاشة «الربط»، مش من هون).
> **الملفات:** كل نظام إله ملف عقد `contracts/<نظام>-mediabuyer.v1.json` (مخطط JSON + مثال طلب/ردّ لكل نقطة). OMS إله كمان المجلد الموجود `contracts/oms-mediabuyer.v1/` (نسخة حرفية من الـOMS، مثبّتة بالـhash). **كل بند «ADD» صغير وإضافي.**

## 1. الخلاصة بجدول

| النظام | شو موجود | شو لازم ينضاف (ADD) | متغيّرات البيئة | بيوقّف؟ |
|---|---|---|---|---|
| **OMS** `crm.zakiai.io` | باب `/api/v1` بمفتاح لكل نظام: `orders/attribution` · `products` · `capi/identifiers` (عقد مجمّد + اختبار). المفتاح بنوعه `mediabuyer` موجود بالـAPI | **A1** خيار `mediabuyer` بشاشة «توكنات الأنظمة» (مقفولة على `replies`) · **A2** قبول ونحفظ وسوم الإعلان بطلب الصفحات والسلات المتروكة · **A3** `stock_units` و`daily_sales_7d` وتعبئة `stock_days` | الميديا باير: `OMS_BASE_URL` `OMS_TOKEN` · الـOMS: `APP_ENCRYPTION_KEY` (موجود) | **نعم** (A1 وA2) |
| **Zaki Pages** `pages.zakiai.io` | يبعت الطلب للـOMS (`source = Landing Page`) بمفتاح `landing` | **P1** يقرا وسوم الرابط ويحفظها طول الزيارة (و«سارة» والسلة المتروكة) · **P2** يبعتها بـ `attribution` مع الطلب والسلة | بيختار أسماءه (مقترح: `OMS_API_BASE` `OMS_LANDING_TOKEN`) | **نعم** (بدونه ما في تكلفة لكل إعلان) |
| **النظام 7 (الردود)** | `GET /api/v1/capacity` بمفتاح `capacity.read` (الميديا باير بتقراه كل 15 دقيقة وبتجمّد التكبير) | **R1** توكن للنظام `mediabuyer` · **R2** (اختياري) `GET /api/v1/ad-signals` أعداد بس | `REPLIES_BASE_URL` `REPLIES_TOKEN` | لا |
| **Zaki Workspace** `workspace.zakiai.io` | باب مهام باتجاه واحد حسب `workspace-door.v1.md` عندهم، والميديا باير مبنية عليه | **W1** تفعيل الباب وتوليد مفتاح `tasks.write`+`tasks.read` (إعداد) | `WORKSPACE_BASE_URL` `WORKSPACE_API_TOKEN` `WORKSPACE_BOARD_ID` | لا |
| **هيرمز + تيليجرام** | الميديا باير بتبعت الطلب (`POST /requests` أو رسالة) وهيرمز بيسحب ويستلم ويسلّم من `/api/v1/video-requests` | **H1** هيرمز يستعمل السحب (بيشتغل من الأردن بلا تيليجرام) · **H2** مواضيع المجموعة: `message_thread_id` للطلبات والاقتراحات | `HERMES_BASE_URL` `HERMES_TOKEN` `TELEGRAM_BOT_TOKEN` `TELEGRAM_OWNER_CHAT_ID` `TELEGRAM_HERMES_CHAT_ID` + مواضيع (ADD) | لا |

**ملاحظة عن «الـOMS ما عنده توكن للأنظمة التانية»:** بحسب كود الـOMS (قراءة فقط) الباب موجود (`V1_SYSTEMS` فيها `mediabuyer`، ومفاتيح هاشها بالقاعدة)، بس **شاشة توليد المفتاح** مثبّتة على نظام الردود، فصعب تلاقيه. هاد البند A1 (خيار واحد بالشاشة).

## 2. الحدّ الأدنى لكل احتياج

| الاحتياج | شو لازم يصير | شو بيوصّل |
|---|---|---|
| **(أ) تكلفة الطلب الحقيقي لكل إعلان** = الصرف ÷ الطلبات الحقيقية، مربوطين بـ `ad_id` | A1 + A2 (OMS) + P1 + P2 (Pages) + مفتاح OMS بالميديا باير | الإعلانات الجديدة (اللي عليها وسوم الرابط). القديمة بتضل «تقدير بالتسمية» |
| **(ب) أيام المخزون لكل منتج** | A3 (أو `stock_days` موجود أصلاً بالـOMS) | رقم أيام التغطية بكرت المنتج وتنبيه المخزون |
| **(ج) وقف التكبير لما الردود تزدحم** | R1 فقط | بلا توكن: ما في وقف (والنظام بيقول «غير مربوط»، مش «تمام») |
| **(د) المهام ذهاباً وإياباً** | W1 فقط | مهام الأشخاص بتنزل عندهم، وبتتسكّر هون لما يخلصوها |
| **(هـ) طلبات الفيديو لهيرمز وتسليم الملفات (Drive IDs) رجوعاً** | H1 (أو `POST /requests` عنده) + مجلدات Drive | الطلب بيوصل وبيرجع `new_videos[].drive_file_id` للبنك «جاهز» |

## 3. كل نظام بالتفصيل (النقاط الدقيقة بملفات JSON)

### 3.1 OMS — `contracts/oms-mediabuyer.v1.json` (+ المجلد المجمّد)
- **الاتجاه:** سحب (الميديا باير تنادي). **التوثيق:** `Authorization: Bearer <مفتاح النظام>`، مفتاح لكل شركة ولكل نظام (`system = mediabuyer`)، بيظهر مرة وحدة، ينتهي بعد 90 يوم، ومفتاح ملغي بيترفض بالنداء الجاي (`401 TOKEN_INVALID`). الصلاحيات: `orders.attribution.read` · `products.read` · `products.economics.read` (الاسم القديم `products.costs.read`) · `capi.identifiers` (بتحطها بإيدك).
- **الحد:** 30 نداء بالدقيقة (`429 RATE_LIMITED`). **الأخطاء:** `{error:{code,message,details}, request_id}`: `TOKEN_MISSING` `TOKEN_INVALID` `SCOPE_MISSING` `VALIDATION_FAILED` `RATE_LIMITED` `INTERNAL`.
- `GET /api/v1/orders/attribution?updated_since=ISO(≤31 يوم)&cursor&limit(≤200)` → `{items, next_cursor}`. ستة حالات: `new · confirmed · shipped · delivered · returned · canceled`. **بلا أي حقل عن الزبون.**
- `GET /api/v1/products?fields=…` → الكود والاسم والتكلفة والأسعار و`stock_days` والرسوم (**null أو بلا قيمة، أبداً مش تخمين**).
- `POST /api/v1/capi/identifiers` → الوحيد اللي بيمرّق معرّفات (بالذاكرة، للأحداث اللي بتنبعت، مش بتتخزّن ولا بتتسجّل ولا بتروح لموديل).
- **ADD A1/A2/A3:** بالملف (حقول اختيارية، الطلب بدونها بيتقبّل متل ما كان).

### 3.2 Zaki Pages — `contracts/pages-mediabuyer.v1.json`
- **الاتجاه:** دفع عبر الـOMS (`POST {OMS}/api/v1/landing/orders` و`/abandoned-carts`)، بمفتاح `landing` الموجود. الميديا باير ما بتحكي مع Pages مباشرة.
- **رابط الإعلان** (الميديا باير بتكتبه لكل إعلان بتنشئه، `URL_TAGS`):
  `utm_source=fb&utm_medium={{site_source_name}}&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}&ad_name={{ad.name}}`
- **الخريطة:** `utm_content`→`attribution.ad_id` · `utm_term`→`adset_id` · `utm_campaign`→`campaign_id` · `ad_name` · `utm_source` · `utm_medium` · `fbclid` · كوكي `_fbc` · `_fbp` · عنوان الصفحة→`landing_url`.
- **ADD P1:** أول زيارة بتقرا الوسوم وبتحفظها 7 أيام (أول لمسة بتفوز إلا إذا إجت نقرة مدفوعة أجدد) وبتضل مع شات «سارة» وصفحة الدفع ورابط السلة المتروكة. أي رقم مش 6–25 خانة بينرمى.
- **ADD P2:** `attribution` اختياري بجسم الطلب والسلة. التحقق بالـOMS (ADD A2).
- الإعلانات القديمة (قبل الوسوم) بتضل بطريقة «تسمية» = تقدير على مستوى المنتج.

### 3.3 النظام 7 (الردود) — `contracts/replies-mediabuyer.v1.json`
- **الاتجاه:** سحب كل 15 دقيقة. `GET /api/v1/capacity` ← `{unanswered, first_response_p50_min?, by_channel?, at}`. **صارم:** أي حقل زيادة بيترفض (عشان ما يمرّق حقل زبون)، و`at` لازم فيه فرق التوقيت.
- **الحكم عند الميديا باير:** معطّل (ما ردّ) · قديم (> ساعتين) · متأخر (> 50 بلا رد) · بطيء (وسيط أول ردّ > 30 دقيقة) ← **بيجمّد التكبير** لمجموعات الرسائل (ما بيوقّف ولا بينزّل). مصدر العقود هناك هو `MKory18/AIresponse`، وهاد الملف جانب الميديا باير منه.
- **ADD R2 (اختياري):** `GET /api/v1/ad-signals?since=` أعداد لكل `ad_id` باليوم، مجموعة أقل من 5 بتنحذف.

### 3.4 Workspace — `contracts/workspace-mediabuyer.v1.json`
- **الاتجاه:** دفع باتجاه واحد. `GET /api/v1/boards` · `POST /api/v1/tasks` (مع `Idempotency-Key: mb-task-<id>`، نفس المفتاح بينشئ المهمة مرة وحدة) · `GET /api/v1/tasks/{id}` (بس الإغلاق بيرجع). الحد 60/دقيقة. بلا مسؤول ولا زبون ولا سعر بالجسم.
- **ADD W1:** تفعيل باب الـAPI بشاشة «الأتمتة» وتوليد المفتاح. ما اتجرّب على Workspace حقيقي لسا.

### 3.5 هيرمز + تيليجرام — `contracts/hermes-mediabuyer.v1.json`
- **أولوية النقل:** (1) هيرمز **بيسحب** (`GET /api/v1/video-requests` ← `claim` ← `complete`) لأنو بيشتغل من أي مكان بلا تيليجرام · (2) الميديا باير بتدفع `POST {HERMES_BASE_URL}/requests` إذا هيرمز بيفتحها · (3) رسالة تيليجرام للمجموعة **من سيرفر الميديا باير** (السيرفر مش محجوب، والأردن محجوب) كإشعار بس.
- **التسليم رجوعاً:** `complete` بياخد `new_videos[{job, v_name, drive_file_id, scenario_file_id}]` فبتنزل للبنك «جاهز» بمعرّفات Drive.
- **ADD H2:** `message_thread_id` (موضوع الطلبات، موضوع الاقتراحات). **ما بنكتب أرقام المجموعة والمواضيع الحقيقية بالريبو** (عام): بتحطها بـ Coolify.

## 4. مثال كامل على الورق: تكلفة الإعلان الحقيقية

**يوم 2026-11-17، إعلان `120211000000000001`:**

1. الميديا باير أنشأت الإعلان ومعه الرابط بالوسوم (الفقرة 3.2). ميتا بتبدّل `{{ad.id}}` بـ `120211000000000001`.
2. الزبون بينقر ← Pages بتقرا `utm_content=120211000000000001` وبتحفظه بالجلسة. حتى لو حكى مع «سارة» أو رجع من سلة متروكة، الوسوم معه.
3. الطلب: `POST /api/v1/landing/orders` فيه `attribution.ad_id = "120211000000000001"` (مع بيانات الزبون **للـOMS بس**).
4. الـOMS بتخزن العمود، وبتعرضه بـ `GET /orders/attribution` كـ `"ad_id": "120211000000000001"` — **بلا اسم ولا رقم ولا عنوان**:
```json
{ "order_id": "0b6c2a8e-5f1d-4c1e-9a7b-2d3e4f5a6b7c", "product_code": "TRF01", "country": "SY", "channel": "landing_page",
  "ad_id": "120211000000000001", "adset_id": "120210000000000005", "campaign_id": "120210000000000009",
  "status": "confirmed", "created_at": "2026-11-17T09:05:00+03:00", "order_value": "20.00", "currency": "USD" }
```
5. الميديا باير بتسحب الطلبات كل ساعة، وبتربط `AttributedOrder.adId` مع `InsightDaily.objectId` (صرف ميتا لنفس الإعلان). ستة طلبات لهالإعلان: جديد 1 · مؤكد 2 · انشحن 1 · تسلّم 1 · انلغى 1، والصرف **42.00$**:

| الرقم | الحساب | النتيجة |
|---|---|---|
| طلبات داخلة | 6 | 6 |
| مؤكّدة (مؤكد أو انشحن أو تسلّم أو رجع) | 2 + 1 + 1 | **4** |
| مُسلَّمة | 1 | **1** |
| تكلفة الطلب الداخل | 42.00 ÷ 6 | **7.00$** |
| **تكلفة الطلب الحقيقي (المؤكد)** | 42.00 ÷ 4 | **10.50$** |
| تكلفة المُسلَّم | 42.00 ÷ 1 | **42.00$** |

القرار على الرقمين الأخيرين (حقيقة الـOMS)، مش على Purchase ميتا. بلا `ad_id` الطلب بيروح لطريقة «تسمية» ورقمه بيتعلّم «تقدير». المثال نفسه (بأرقامه) مكتوب بـ `pages-mediabuyer.v1.json` والاختبار `tests/integration-contracts.test.ts` بيعيد الحساب.

## 5. ترتيب الإطلاق (وليش)

1. **OMS: A1 + مفتاح + `OMS_BASE_URL`/`OMS_TOKEN`** — بدونه ما في ولا طلب حقيقي، وكل شي بعده بيعتمد عليه. بيفتح (أ) على مستوى التسمية و(ب) فوراً. *(نقرتين بشاشة، بلا برمجة تقريباً.)*
2. **OMS A2 ثم Pages P1+P2** — A2 أول (يقبل ويحفظ)، بعدين Pages (تبعت). بيفتح (أ) كاملة لكل إعلان. بترتيب معكوس الطلب بينرفض أو الوسوم بتنرمى.
3. **النظام 7: R1** — توكن واحد، بيفتح (ج). خطر قليل وقراءة بس.
4. **Workspace: W1** — إعداد، بيفتح (د).
5. **هيرمز: H1 ثم H2** — بيفتح (هـ). تيليجرام آخر شي لأنو إشعار مش ضروري، ومحجوب بالأردن.
6. **تأكيد الأرقام:** قارن 3 طلبات بإيدك مع شاشة الإسناد بالـOMS. وCAPI: ولا مرسل مزدوج لنفس البكسل (أحداث الـOMS تتقفل قبل ما الميديا باير تروح `live`).

## 6. كل متغيّرات Coolify (مثال غير سرّي)

| النظام | المتغيّر | مثال | سرّي؟ |
|---|---|---|---|
| OMS | `OMS_BASE_URL` | `https://crm.zakiai.io` | لا |
| OMS | `OMS_TOKEN` | — | **نعم** |
| OMS | `CAPI_TEST_EVENT_CODE` | `TEST12345` | لا |
| الردود | `REPLIES_BASE_URL` | `https://<host-النظام-7>` | لا |
| الردود | `REPLIES_TOKEN` | — | **نعم** |
| Workspace | `WORKSPACE_BASE_URL` | `https://workspace.zakiai.io` | لا |
| Workspace | `WORKSPACE_API_TOKEN` | — | **نعم** |
| Workspace | `WORKSPACE_BOARD_ID` | `brd_example` | لا |
| هيرمز | `HERMES_BASE_URL` | `https://<host-هيرمز>` | لا |
| هيرمز | `HERMES_TOKEN` | — | **نعم** |
| تيليجرام | `TELEGRAM_BOT_TOKEN` | — | **نعم** |
| تيليجرام | `TELEGRAM_OWNER_CHAT_ID` | `123456789` | لا |
| تيليجرام | `TELEGRAM_HERMES_CHAT_ID` | `-1001234567890` | لا |
| تيليجرام | `TELEGRAM_HERMES_REQUESTS_THREAD_ID` (ADD) | `1001` | لا |
| تيليجرام | `TELEGRAM_HERMES_SUGGESTIONS_THREAD_ID` (ADD) | `1002` | لا |
| Drive | `GOOGLE_SERVICE_ACCOUNT_JSON` | — | **نعم** |
| Drive | `DRIVE_PRODUCTS_FOLDER_ID` · `DRIVE_PRODUCTION_FOLDER_ID` · `DRIVE_STUDIO_FOLDER_ID` | `1AbCdEfGhIjKlMnOpQrStUvWxYz012345` | لا (معرّف مجلد) |
| الميديا باير | `META_SYSTEM_USER_TOKEN` | — | **نعم** |
| الميديا باير | `OAUTH_REDIRECT_HOSTS` (اختياري) | `tools.example.com` | لا |
| داخل الأنظمة التانية | `APP_ENCRYPTION_KEY` (OMS)، `OMS_API_BASE` و`OMS_LANDING_TOKEN` (Pages، أسماء مقترحة) | — | **نعم** للمفاتيح |

> الأرقام الحقيقية (معرّف المجموعة، المواضيع، المجلدات) بتبقى بـ Coolify. الريبو عام.

## 7. اللي انقرأ واللي ما انقرأ (بصدق)

- **انقرأ (قراءة فقط):** كود الميديا باير (المحوّلات والاختبارات) · نسخة محلية من الـOMS على فرع `feat/confirmation-v2-step-d2` (أبواب `/api/v1` ونوع المفتاح `mediabuyer` ومدخل الطلب) · مجلد العقود `contracts/oms-mediabuyer.v1/`.
- **ما انقرأ:** كود Zaki Pages، والنظام 7، وWorkspace، وهيرمز (ما إلهم نسخة هون). كلامي عنهم من كود الميديا باير ومن `docs/INTEGRATIONS.md`. **كل بند فيهم «VERIFY» لحد ما جلسة كل نظام تأكّد.**
- **VERIFY بالـOMS:** هل مدخل الطلبات على الـmain عندو أصلاً `adset_id`/utm/`fbc` (الميديا باير بتتوقعه من PR #164)؟ النسخة المحلية فيها `ad_id` بس. وهل `stock_days` بيرجع قيمة؟
- **ما اتجرّب:** ولا ربط حي. كل شي هون تصميم + اختبارات على الملفات.

## 8. برومبت لكل نظام (انسخه لجلسته)

- **OMS:** «اقرا `contracts/oms-mediabuyer.v1.json` بريبو الميديا باير (القسم ADD). نفّذ A1: خيار نظام `mediabuyer` بشاشة توكنات الأنظمة. A2: اقبل واحفظ `attribution.{adset_id,campaign_id,ad_name,utm_source,utm_medium,fbclid,fbc,fbp,landing_url}` بطلبات `/api/v1/landing/orders` والسلات، وأرجع `ad_id/adset_id/campaign_id/ad_name/landing_page` بـ `/orders/attribution`. A3: `stock_units`, `daily_sales_7d` وعبّي `stock_days`. كلها حقول اختيارية؛ ولا تغيير يكسر عقد `oms-mediabuyer.v1`. ولا حقل زبون بأي ردّ.»
- **Zaki Pages:** «اقرا `contracts/pages-mediabuyer.v1.json`. P1: اقرا وسوم الرابط بأول زيارة واحفظها 7 أيام (تضل مع «سارة» والدفع والسلة المتروكة). P2: ابعتها بكائن `attribution` اختياري بطلبات OMS. بلا أي بيانات زبون بالوسوم.»
- **النظام 7:** «اقرا `contracts/replies-mediabuyer.v1.json`. تأكد إن `GET /api/v1/capacity` بيطابق المخطط (ولا حقل زيادة، و`at` بفرق توقيت). اعمل توكن للنظام `mediabuyer` بصلاحية `capacity.read`. (اختياري) `GET /api/v1/ad-signals` أعداد بس.»
- **Workspace:** «اقرا `contracts/workspace-mediabuyer.v1.json` وقارنه بـ `workspace-door.v1.md` عندك. فعّل الباب وولّد مفتاح `tasks.write`+`tasks.read` وتأكد من `GET /api/v1/boards`. بلّغ بأي فرق.»
- **هيرمز/تيليجرام:** «اقرا `contracts/hermes-mediabuyer.v1.json`. خلّي هيرمز يسحب `GET /api/v1/video-requests` ويعمل `claim` و`complete` بـ `new_videos[].drive_file_id`. إذا بتفتح `POST /requests` بلّغ. تيليجرام للإشعار بس.»
