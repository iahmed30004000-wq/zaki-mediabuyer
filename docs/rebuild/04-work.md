# 04 — الشغل: المهام المجدولة، الأوامر السارية، التقارير، وبانتظارك

> النماذج: `#work` `#job` `#inbox`. الصلاحيات: `05-permissions.md`.
> القاعدة: **Claude بيشتغل، والموقع بيعرض وبيقرّر وبيحفظ القواعد.** الموقع ما بيصير هو المنفّذ.

## 1. الكلمات

| بالواجهة | بالكود (موجود) | شو هو |
|---|---|---|
| **مهمة مجدولة** | `Workflow` | شغلة بيعملها Claude أو وكيل بموعد (أو عند الطلب) |
| **فرع** | عقدة بـ `Workflow.graph.nodes` | جزء من المهمة برقم (1.1 · 1.2)، بينطفي لحاله |
| **تشغيل** | `WorkflowRun` | مرة اشتغلت فيها المهمة: الوقت، الحالة، سطر النتيجة، الأرقام |
| **تقرير** | `WorkflowRun.report` (جديد) + `Report` | نص التشغيل الكامل |
| **أمر ساري** | `StandingOrder` (جديد) | تعليمة مؤقتة من المالك بتأثّر على مهام، لحد تاريخ أو لحد «ارجع» |
| **قرار** | صف من `Approval` / `ChangeSet` / `Handoff` / … | أي شي بيستنى المالك (§6) |
| **مهمة فريق** | `Task` | شغلة لشخص أو وكيل، مرة وحدة |

أسماء الجداول والأدوات ما بتتغيّر. اللي بيتغيّر: الكلمة بالواجهة، وحقول جديدة.

## 2. المهمة المجدولة

### الحقول

الموجود بـ `Workflow`: `key` `name` `description` `schedule` (cron بتوقيت عمّان) `executor` `permission` `enabled` `graph` `version` `archivedAt`.

الجديد (هجرة إضافية بـ P5، كلها اختيارية):

| العمود | النوع | المعنى |
|---|---|---|
| `number` | `Int?` | الرقم عالخريطة. فاضي = لسا مش مرقّمة (بتطلع بآخر العمود) |
| `domain` | `String @default("ads")` | `ads` · `ops` |
| `kind` | `String @default("recurring")` | `recurring` متكررة · `once` مرة وحدة · `window` لفترة وبتخلص لحالها · `manual` عند الطلب |
| `scheduleText` | `String?` | الموعد بالكلام لما ما في cron («الليلة 12:30»، «كل ساعتين لآخر اليوم») |
| `runsAt` | `DateTime?` | وقت التشغيل للمرة الوحدة |
| `endsAt` | `DateTime?` | إيمتى بتخلص «لفترة» |
| `finishedAt` | `DateTime?` | خلصت (مرة وحدة اشتغلت، أو فترة انتهت) |
| `runsFrom` | `String?` | «بتشتغل من» (أي وكيل / أي جلسة) |
| `origin` | `String?` | «من وين إجت»: التاريخ وكلام المالك |
| `touches` | `String[]` | «بتلمس»: الأنظمة |
| `talksTo` | `String[]` | «بتحكي مع»: الناس (مفاتيح من دليل الفريق لما بتتطابق، وإلا نص) |
| `note` | `String?` | ملاحظة الوكيل |
| `advice` | `String?` | `keep` · `merge` · `cancel` · `lighten` · `think` |
| `adviceText` | `String?` | سبب التوصية بسطر |
| `decision` | `String?` | قرار المالك: `keep` · `cancel` · `merge` |
| `decidedAt` | `DateTime?` | |
| `source` | `String @default("seed")` | `seed` · `ui` · `mcp` (مين عرّفها) |

وعلى `WorkflowRun`: `report String?` (النص الكامل، لحد 6000 حرف).
وعلى العقدة (`NodeSchema`): `desc` (لحد 300): «شو بيعمل» الفرع بكلام المالك.

كل نص جديد بيمرّ على فلتر الخصوصية (`refuseIfPrivate`): رقم هاتف أو إيميل أو مفتاح = رفض.

### الترقيم والترتيب

- بالعمود: حسب `number` ثم الاسم. المجالين عمودين.
- رقم الفرع = `<رقم المهمة>.<ترتيبه بين فروع المهمة>` حسب `stepOrder(graph)` الموجود، للعقد اللي نوعها مش `trigger`. دالة نقية: `branchNumbers(job)`.
- الرقم ثابت للمهمة: هو اللي بتحكي فيه مع Claude («ألغي 7 و11.3»).

### شارة الحالة (دالة نقية `jobStatus(job, lastRun, now)`)

| الشرط (بالترتيب) | الشارة | اللون |
|---|---|---|
| `!enabled` | موقوفة | رمادي |
| `finishedAt` موجود، أو `window` و`endsAt` فات | خلصت | رمادي |
| آخر تشغيل `failed` | فشلت | أحمر |
| آخر تشغيل `waiting` وفي تسليم مفتوح | متوقفة | أحمر |
| `once` | مرة وحدة جاية | برتقالي |
| `window` | بتخلص لحالها | أزرق |
| `manual` | عند الطلب | رمادي |
| غير هيك | شغّالة | أخضر |

العدّادات فوق الخريطة = عدّ هاي الشارات (`jobCounters(jobs)`).

### الموعد بالكلام (دالة نقية `scheduleWords(job, now)`)

`scheduleText` لو موجود. وإلا من الـ cron: «كل يوم 12:35 بالليل» · «كل ساعة من 10 الصبح لـ10 بالليل (13 جولة)» · «كل خميس 11:20 الصبح» · «6 مرات: 11:07 · 1:07 · …». للأنماط اللي ما بتنفهم: نص الـ cron نفسه + «الجاي: …» من `nextRuns()` الموجودة. وإلا «عند الطلب».

## 3. الشاشات

**الخريطة** (`/work`): §3.3 بـ `02`. بطاقة المهمة (`JobCard`): الرقم · الاسم · الشارة ← الموعد بالكلام + مين بينفّذ ← شرايح الفروع (المطفي مشطوب) ← سطر واحد: آخر نتيجة (✓/✗ + وقت + `summary`) أو «الجاي: …» أو شارة التوصية لو في توصية بلا قرار.

**صفحة المهمة** (`/work/job/[key]`) بالترتيب:
1. الهيدر: رجوع · الرقم · الاسم · «المجال · النوع» · الشارة · مفتاح تشغيل/إطفاء (`work.control`).
2. جدول الحقايق (`FactsTable`): الموعد · بتشتغل من · من وين إجت · بتلمس · بتحكي مع. الحقل الفاضي ما بينعرض.
3. الوصف (`description`).
4. **الأوامر السارية** اللي بتأثّر عليها (§5) + «＋ أمر جديد».
5. **الفروع**: الرقم · العنوان · `desc` · مفتاح (بيقلب `disabled` وبيحفظ نسخة جديدة للرسم بنفس خدمة الحفظ الموجودة).
6. **القواعد اللي بتقراها**: قراءة بس، من `getRules()`، مع رابط «عدّل القواعد» (للمالك) ← `/settings/rules`. الأرقام بتبيّن بس للي معه `money.view`.
7. **آخر التشغيلات** (10): الشارة · `summary` · الوقت ← صفحة التقرير.
8. الملاحظة والتوصية، و«قرارك: خلّيها / ألغيها / ادمجها» لو لسا ما تقرر.
9. «شغّلها هلأ» (نفس `/api/workflow/[key]/run` الموجود) · «متقدّم» ← الرسم، النسخ، «من الموقع».

**اليوم** (`/work/today`): خط اليوم الكامل.
- «يوم الشغل» للخط = من 06:00 لـ 06:00 بتوقيت عمّان (عشان جولة الليل بعد نص الليل تضل بيومها، متل عيّنتك). الليل مظلّل من 22:00.
- دالة نقية `dayLine(jobs, runs, day, now)` بترجّع لكل مهمة نقاطها: المواعيد المتوقعة من `runsBetween(cron, from, to)` الموجودة + `runsAt` للمرة الوحدة. كل موعد بياخد أول تشغيل بدأ بين 5 دقايق قبله و30 بعده.
- حالة النقطة: `done` (أخضر) · `failed` (أحمر) · `running` (حلقة) · `next` (فاضية، لسا ما إجا وقتها) · `missed` (رمادي بخط: فات وقتها وما اشتغلت). التشغيل اليدوي بلا موعد نقطة لحالها.
- تحت الخط: «أزحم وقت» (أكتر نص ساعة فيها مواعيد) بسطر، و«اللي انعمل» من `loadDay()` الموجود.

**التقارير** (`/work/reports`): خلاصة موحّدة:
```ts
interface ReportItem {
  id: string;                    // "run:<id>" أو "report:<id>"
  title: string;                 // اسم المهمة، أو «التقرير الصباحي/الأسبوعي/الشهري»
  jobKey?: string; jobNumber?: number;
  domain: "ads" | "ops" | null;
  status: "ok" | "failed" | "waiting";
  at: string;
  summary: string | null;
  hasFull: boolean;              // في نص كامل (report)
}
```
المصدر: `WorkflowRun` (اللي إله `summary` أو `report`) + جدول `Report`. صفحة التقرير: النص، أرقام التشغيل (`metrics`) كجدول، الروابط (`artifacts`)، وطباعة.

## 4. ورقة القرار

وضع بـ «المجدولة» (`work.control`): جدول كل المهام وفروعها بعمودين اختيار (خلّيها · ألغيها) وعمود توصية الوكيل. «ابعت القرار»:

1. `POST /api/work/decisions` `{ items: [{ key, decision: "keep"|"cancel"|"merge", branches?: { [nodeId]: boolean } }] }` — معاملة وحدة:
   - `cancel` ← `enabled=false` و`decision="cancel"` (والمرة الوحدة `finishedAt=now`).
   - `keep` ← `decision="keep"` (بتختفي التوصية).
   - `merge` ← `decision="merge"` و`enabled=false`، مع ملاحظة «انضمّت لـ <رقم>».
   - الفروع ← `disabled` على العقدة + نسخة رسم جديدة.
2. تسليم واحد لـ Claude (`createHandoff`, `kind: "needs_input"`) عنوانه بالأرقام: «ورقة القرار: ألغي 7 · 8 · الفرع 11.3 — ادمج 2 · 3 · 4 بـ 1». هيك Claude بيشيلها من جدولته هو.
3. سطر بالتدقيق لكل مهمة (`work.decision`).

Claude أصلاً بيعرف إن مهمة انطفت: جواب `log_run` بيرجّع `enabled=false` (موجود). والتسليم بيضمن إنه يشيلها من جدولته قبل الموعد.

## 5. الأوامر السارية (جديد)

**المشكلة:** لما المالك بيقول «ما في فيديو جديد لحد ما أقلك ارجع»، اليوم الأمر بيعيش بمحادثة Claude وبيتحوّل لمهام تذكير مجدولة. بالعيّنة 3 من 18 مهمة هيك.

**الحل:** الأمر بيانات بالموقع، كل مهمة بتقراه أول ما تبدأ.

```prisma
model StandingOrder {
  id        String    @id @default(cuid())
  text      String                        // الأمر بكلام المالك (≤ 300، بيمرّ على فلتر الخصوصية)
  effect    String                        // restrict (بيشدّد) | allow (بيرخّي)
  domain    String    @default("ads")     // ads | ops | all
  jobKeys   String[]  @default([])        // فاضي = كل مهام المجال
  products  String[]  @default([])        // فاضي = كل المنتجات
  startsAt  DateTime  @default(now())
  endsAt    DateTime?                     // فاضي = لحد «ارجع»
  status    String    @default("active")  // pending | active | ended | rejected
  endedAt   DateTime?
  endedBy   String?
  source    String    @default("ui")      // ui | mcp (Claude نقله عن كلام المالك)
  saidAt    DateTime?                     // إيمتى قاله المالك
  createdBy String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  @@index([status, domain])
}
```

القواعد (دوال نقية بـ `src/core/orders.ts`):
- `isActive(order, now)`: `status=active` و`startsAt ≤ now` و(`endsAt` فاضي أو لسا ما إجا). الأمر اللي فات `endsAt` بيتسكّر لحاله (`ended`).
- `appliesTo(order, job, productCode?)`: المجال مطابق أو `all`، و`jobKeys` فاضية أو فيها المهمة، و`products` فاضية أو فيها المنتج.
- **بيشدّد** (`restrict`: وقّف، لا تعمل، خفّض): بيتسجّل فعّال فوراً من أي مصدر. **بيرخّي** (`allow`: زيد، اسمح، ارجع): لو من غير المالك عالموقع بيصير `pending` وبينزل قرار بـ «بانتظارك». إنهاء أمر بيشدّد = ترخية.
- «ارجع» (المالك عالموقع): `status=ended` + مين وإمتى. ولا حذف: الأرشيف بـ `/settings/rules`.

وين بيظهر: صفحة المهمة · لوحة المجال («أوامر سارية») · صفحة المنتج · «بانتظارك» (للمعلّق) · «قررتها».

كيف Claude بيقراه: `get_rules` بيرجّع حقل زيادة `standing_orders` (الفعّال بس). الوصف المكتوب للأداة بيقول: «اقرا الأوامر السارية أول كل تشغيل، والأمر اللي بيشدّد بيغلب أي قاعدة».

## 6. بانتظارك: نوع واحد لكل قرار

اليوم خمس مصادر بخمس بطاقات. الجديد: نموذج قراءة واحد فوق الجداول الموجودة (**بلا جدول جديد**):

```ts
// src/core/inbox.ts — نقي
export type InboxKind = "spend" | "safety_net" | "launch" | "message" | "order" | "advice" | "stuck" | "creative" | "stock" | "other";
export interface InboxAction {
  key: "approve" | "reject" | "later" | "send" | "edit" | "keep" | "cancel" | "retry" | "reassign" | "open";
  label: string;                       // «وافق» · «ابعت» · «ألغيها» …
  variant: "primary" | "secondary" | "ghost";
  confirm?: boolean;                   // بيسأل «متأكد؟»
  capability: string;                  // القدرة المطلوبة (05)
}
export interface InboxItem {
  id: string;                          // "<source>:<rowId>" مثل "change:ck…" · "approval:ck…" · "handoff:ck…"
  kind: InboxKind;
  domain: "ads" | "ops" | "work";
  title: string;                       // جملة وحدة
  why: string | null;
  effect: { moneyDeltaDaily?: number | null; moneyAfter?: number | null; people?: string[]; text?: string } | null;
  preview?: string;                    // نص الرسالة، أو ملخّص التجربة
  from: { label: string; jobKey?: string } | null;
  at: string;
  urgency: "red" | "orange" | "yellow";
  expiresAt: string | null;
  actions: InboxAction[];              // من 1 لـ 3، الأول هو الأساسي
}
```

| المصدر | الشرط | النوع | الأزرار ← العنوان الموجود |
|---|---|---|---|
| `ChangeSet` | `pending_approval` | `spend` / `safety_net` / `launch` حسب `kind` | وافق · ارفض ← `/api/changes/[id]` · «جرّب أول» (هادي) |
| `Approval` | `pending` أو `postponed` | `message` لو `kind="send_message"` · `stock` لو `kind="stock"` · `spend` لو فيه `amount` · وإلا `other` | من `options` الصف (الأول أساسي) + «أجّل» ← `/api/approvals/[id]` |
| `Handoff` | `open`/`claimed` و(المكلّف شخص، أو النوع فشل/مهلة/ربط ناقص وعمره فوق 30 دقيقة) | `stuck` | أعد المحاولة · سلّمها لـ… · ألغِها ← `/api/handoffs/[id]` |
| `CreativeAsset` | `status="review"` | `creative` | وافق · استبعد ← `/api/creatives/[code]` |
| `LaunchRequest` | بانتظار المالك | `launch` | افتح المعالج |
| `Workflow` | `advice` موجودة و`decision` فاضي | `advice` | حسب التوصية: ألغيها/خلّيها · ادمجها/خلّيها ← `/api/work/decisions` |
| `StandingOrder` | `pending` | `order` | وافق · ارفض ← `/api/orders/[id]` |

- **الترتيب** (`sortInbox`): الأحمر ← اللي بينتهي وقته أقرب ← الأحدث.
- **العدّاد** بالقائمة والشريط = عدد العناصر المفتوحة اللي المستخدم بيقدر يقرّر فيها.
- **«أجّل»** بس للي بيدعمه (`Approval`). تغييرات ميتا ما بتتأجّل: وافق أو ارفض.
- **«قررتها»**: `Approval` المقرّر + `ChangeSet` (تنفّذ · انرفض · انرجع · فشل، مع فلتر «لحاله» للي مصدره قاعدة) + الأوامر المنتهية + قرارات المهام. آخر 30 يوم، صفحات. «رجّع» = `rollback` الموجود.
- **رسالة بدها «ابعت»:** الوكيل بيطلبها بـ `request_approval` الموجودة بـ `kind: "send_message"` و`analysis: { to, channel, text }` و`options: [{key:"approve",label:"ابعت"},{key:"reject",label:"لا"}]`. الموقع ما بيبعت الرسالة: الوكيل بيقرا القرار (`get_approvals`) وبيبعت هو. «عدّل» بيخلّي المالك يغيّر النص قبل الموافقة (بينحفظ بـ `decisionNote`).
- **القاعدة اللي ما بتنكسر:** الموافقة على أي شي بيصرف من الموقع بس. تيليجرام بيقول «افتح الموقع» وبيودّي لـ `/inbox/<id>`.

## 7. مهام الفريق

جدول `Task` ولوحاته وحقوله وأزراره ودفعه لـ Workspace: كما هم. الواجهة:
- العرض الافتراضي **قائمة مجمّعة بالشخص** (المتأخر أول)، وكل سطر: العنوان · الموعد · اللوحة · الأولوية · شارة «على Workspace» لما في `wsId`.
- **كانبان** مبدّل عرض تاني (الخمس أعمدة الحالية).
- الإضافة بسطر واحد بتضل («بكرا لميوز: اعمل 4 هوكات»).
- دور «عضو» بيشوف مهامه بس (`tasks.own`).

## 8. اللي بيتزاد على أدوات Claude (كله اختياري، ولا أداة قديمة بتتغيّر)

### `push_jobs` (جديدة، P6) — Claude بيبعت خريطة مهامه

```ts
{
  jobs: Array<{                                  // من 1 لـ 40
    key: string;                                 // ^[a-z0-9-]{2,60}$ — نفس مفتاح log_run
    number?: number;                             // 1..999
    name: string;                                // ≤ 120
    domain: "ads" | "ops";
    kind: "recurring" | "once" | "window" | "manual";
    schedule?: string;                           // cron بخمس خانات، توقيت عمّان
    schedule_text?: string;                      // ≤ 80
    runs_at?: string; ends_at?: string;          // ISO
    runs_from?: string; origin?: string;         // ≤ 60 · ≤ 200
    touches?: string[]; talks_to?: string[];     // ≤ 8 لكل وحدة
    description?: string; note?: string;         // ≤ 500 · ≤ 300
    advice?: "keep" | "merge" | "cancel" | "lighten" | "think"; advice_text?: string;
    branches?: Array<{ id: string; label: string; desc?: string; enabled?: boolean }>;  // ≤ 20
    finished?: boolean;
  }>;
  replace?: boolean;                             // true: مهام مصدرها mcp ومش بالقائمة بتتعلّم «خلصت»
}
```

- بتحدّث أو بتنشئ حسب `key`. المهمة الجديدة رسمها: بداية + الفروع بخط مستقيم. الموجودة: بتتحدّث الحقول، والفروع بتتطابق بالـ `id` (الجديد بينضاف، الموجود بيتحدّث عنوانه ووصفه).
- **مفتاح المالك بيغلب:** مهمة أو فرع طفّاه المالك عالموقع ما بترجع تشتغل بـ `push_jobs`. و`decision` المالك ما بتنمسح.
- الجواب: لكل مهمة `enabled`، حالة فروعها، و`decision` — عشان Claude يطابق جدولته.
- ولا شي بينحذف. الخصوصية: كل النصوص على الفلتر.

### `record_order` و `end_order` (جديدتين، P7)

`record_order { text, effect: "restrict"|"allow", domain?, job_keys?, products?, until?, said_at? }` ← أمر ساري. `restrict` فعّال فوراً. `allow` معلّق وبينزل قرار. الجواب بيقول أي واحد صار.
`end_order { id }` ← طلب إنهاء، وبينزل قرار للمالك (الإنهاء ترخية).

### إضافات على أدوات موجودة

| الأداة | الإضافة |
|---|---|
| `log_run` | حقل `report` (≤ 6000): نص التقرير الكامل. بينحفظ بـ `WorkflowRun.report` |
| `get_rules` | حقل `standing_orders` بالجواب: `[{ id, text, effect, domain, job_keys, products, since, until }]` |
| `push_metrics` | مستوى `person` (P9): أرقام موظف ليوم (`06` §3) |

### عقد أسماء أرقام التشغيل (`log_run.metrics`)

اللوحات بتقرا هالمفاتيح لو موجودة (وبتخفي البلاطة لو مش موجودة — ما بتخمّن):

| المهمة | المفاتيح |
|---|---|
| جولة الليل | `scaled` `paused` `ads_paused` `stock_alerts` `spend_tomorrow` |
| خطة سدّ التسريب | `open_over_24h` `orders_in` `confirmed` `confirm_rate` |
| فحص نزول الشحنات | `confirmed` `landed` `not_landed` `ready` `postponed` |
| جمع الفيديوهات | `new_videos` `duplicates` |

### اللي لازم ينزاد على سكيل Claude (شغل المالك / Claude الرئيسي، مش البنّاء)

1. بعد أي تغيير بجدولته: `push_jobs` بالخريطة كلها (`replace: true`).
2. أول كل تشغيل: `get_rules` وقراءة `standing_orders`.
3. لما المالك يعطي أمر مؤقت بالمحادثة: `record_order` بدل مهمة تذكير.
4. آخر كل تشغيل: `log_run` مع `report` والمفاتيح فوق.
5. الرسالة اللي بدها «ابعت»: `request_approval` بـ `kind: "send_message"`.

## 9. الهجرات (كلها إضافية)

| المرحلة | الهجرة |
|---|---|
| P5 | أعمدة `Workflow` الجديدة · `WorkflowRun.report` · تعبئة الـ16 مزروعة: `domain` و`kind` و`number` (جدول التعبئة بـ `07-phases.md`) |
| P7 | `StandingOrder` |
| P9 | `PersonDay` |
| P10 | `Actor` · `ApiToken.actorKey` · قيم جديدة بـ `Role` |
