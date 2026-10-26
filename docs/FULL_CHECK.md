# الفحص الشامل (الـ SPEC 17.4)

آخر تشغيل: 2026-10-26 09:11 UTC · 12 من 12 نجح · كله على القاعدة المحلية بوضع dry-run، وميتا والـ OMS وهميين.

> بيتعاد بـ `npm run check:full` قبل تسليم الحساب الإعلاني الحقيقي، وبعد أي تغيير كبير. أول حدث CAPI حقيقي بيتجرّب بأداة Test Events عند ميتا (`CAPI_TEST_EVENT_CODE`).

### ✅ التحضير — بيانات تجريبية: ميتا والـ OMS الوهميين ← الأرشيف والحقيقة

`npx tsx --env-file=.env scripts/demo-pipeline.ts`

```
✓ second pull changed nothing
✓ spec 17.1 reproduced from the pipeline
```

### ✅ المسار الكامل — فيديو بـ inbox ← فحص وتسمية ← رفع ← حملة كـ ChangeSet ← موافقة ← إنشاء موقّف ← تحقق ← تفعيل ← طلب برقم الإعلان ← الحقيقة ← قاعدة ← تقرير ← حدث CAPI

`npx tsx --env-file=.env scripts/full-path.ts`

```
✓  1. video in 01_inbox → ready as TRF01_CR00013_5476.mp4
✓  2. checked and named: policy green, 6 thumbnails
✓  3. upload → dry_run (stand-in video id dry_v_CR00013)
✓  4. campaign SY_TRF01_WEB_CRT_261026_C04 as one ChangeSet → waits for approval (+15$/day)
✓  5. approved on the site → executed
✓  6. created PAUSED and verified against the template
✓  7. switched on only after the check
✓  8. 6 OMS orders tied to CR00013_H07_HER_LP1 by its ad id
✓  9. the truth: 4 confirmed, 3.74$ per confirmed (spend × 1.01 ÷ mature confirmed)
✓ 10. the rules: not a loser · the ladder: ما ثبت 3 أيام ورا بعض تحت السقف 6.23$ (— · — · 3.74)
✓ 11. the morning report lists CR00013 among the best ads
✓ 12. CAPI: Purchase for order PATH-CR00013-0 → sent (against the pretend Meta)
```

### ✅ الأمان — قاعدة الخاسر بتوقف · الإيقاف الكامل · الرجوع · منع اللوب

`npx tsx --env-file=.env scripts/demo-guard.ts`

```
✓ 1. the loser was paused by the rule (state executed, S01) — «وقّفت الإعلان لأنه صرف 12.12$ (2 × هدف الطلب 4.05$) بـ 81 ساعة بلا ولا طلب.»
✓    …in dry-run: recorded what it would send, sent nothing
✓    …and the rule run is logged once
✓    …a second run inside the cooldown does nothing again
✓ 2. a raise at level 1 waits for approval (state pending_approval, +8$/day)
✓ 4a. «رجّع» resumed the ad with a new change and marked the original rolled_back
✓ 4b. pause → resume → pause in 48 h: frozen and sent to the owner (loop guard)
✓ 3. the kill switch paused 7 campaigns at once (state executed)
✓    …every step is in the audit log
```

### ✅ الأمان والمال — الإطلاق بموافقة · حساب مقيّد ← صفر · 3 رفض ← تجميد الإنشاء

`npx tsx --env-file=.env scripts/demo-launch.ts`

```
✓ 1. «SY_TRF01_WEB_CRT_261026_C01» waits for the owner (pending_approval) · 30$/day
✓    …with its test: «اختبار إبداعات: أي مفهوم بيجيب طلب مؤكد تحت 6.23$»
✓ 2. approved → executed (15 items, dry-run)
✓    …everything created PAUSED, in order
✓    …each creative opts out of all 43 enhancements by name
✓    …the ad points at the ad set and creative made just before it
✓    …and switched on last: ads → ad sets → campaign
✓ 3. the test is running until 2026-10-30
✓    …«رجّع» paused the 6 objects it switched on (creatives stay, nothing deleted)
✓    …and its test stopped with it
✓ 4. forbidden claim refused: نص الإعلان فيه ممنوع: «بيشفي» ← «تُستعمل ضمن روتين العناية اليومي»
✓    …a video not on Meta yet refused: CR00001: لسا ما انرفع لميتا
✓ 5a. restricted account → level 0: even a safety pause is only suggested (simulated)
✓ 5b. 3 rejections in 24 h: creation frozen, 3 appeal drafts written (sent by a person only)
✓    …and the next launch is refused: الإنشاء مجمّد على هالحساب: 3 إعلانات انرفضت خلال 24 ساعة — جمّدت الإنشاء 24 ساعة
✓ 6. attribution: weak · 100% tied by ad id · 6 campaign gap(s) — worst JO_NFG01_WEB_TEST_261019_C01 -40%
```

### ✅ المال — سلّم التكبير: المستوى 1 بيستنى، المستوى 2 ضمن السقف · الخطة ضمن السقف

`npx tsx --env-file=.env scripts/demo-phase5.ts`

```
✓ 0. the ladder: كبّرت المجموعة 30.00$ ← 36.00$ باليوم: 3 أيام تحت السقف 6.23$ (آخر يوم 4.21$ للمؤكد، 18 مؤكد ناضج).
✓ 1a. level 1: the raise waits for you (pending_approval, +6$/day)
✓ 1b. level 2: raised on its own 30$ → 36$ (executed, dry-run)
✓    …and not again today: بمرحلة التعلّم: آخر تعديل جوهري قبل أقل من ساعة (بدنا 72) | انرفعت اليوم خلص | آخر زيادة قبل أقل من ساعة (بدنا 48)
✓ 2. level 2 needs two weeks of decisions; level 3 is off
✓ 3a. the week's plan: 595.91$ a day in 5 lines, inside the caps (written by agent)
✓ 3b. weekly report built by code (1313 chars, 3 lesson(s) kept)
✓    …and the monthly one with the system's accuracy (689 chars)
✓ 4. the consultant (agent): 11 facts, every number tagged, no customer data
```

### ✅ التحويلات — حدث ناجح · منع التكرار · حد الأيام السبعة · ولا معرّف محفوظ

`npx tsx --env-file=.env scripts/demo-capi.ts`

```
✓ 1. 199 events queued from 119 orders · a second run queued 0
✓ 2. 11 event(s) older than 7 days marked expired, never sent
✓ 3. sent 146 · skipped 42 · rejected 0
✓    …and the database holds only Meta's answer (no phone, no click id, no hash)
✓    …a second send sends nothing
```

### ✅ الإبداعات — مكرر بيتلقط · نص KamaaEye بيتعلّم · الترقيم ما بيتكرر

`npx tsx --env-file=.env scripts/demo-creatives.ts`

```
✓ good video → ready TRF01_CR00014_2d82.mp4
✓    …9:16, 6 candidate thumbnails
✓    …named {PRODUCT}_CR#####_{md5}.mp4
✓ its copy → duplicate of CR00014
✓ 540p, no sound, black start → review: فحص الملف: الدقة أقل من 720p (540×960) · ما فيه صوت · أول إطار أسود — الغلاف الحقيقي بالفيد
✓ the KamaaEye text → excluded
✓    …numbers never repeat: CR00014, CR00015, CR00016
```

### ✅ النسخ الاحتياطي — نسخة كاملة ← استرجاع بقاعدة فاضية ← كل جدول مطابق

`npx tsx --env-file=.env scripts/backup-restore-check.ts`

```
✓ backup: 38 tables, 785 rows, migration 20261026110000_phase5_lessons
✓ restore into an empty database: 785 rows, every table matches the manifest
✓ a second restore into the same (now full) database is refused: «the target database is not empty (AuditLog) — restore goes into an empty one»
✓ the restored database answers: 10 change sets, 119 orders
```

### ✅ الأسرار والخصوصية — ولا توكن ولا هاتف ولا إيميل زبون بأي سجل أو تقرير أو قرار

`npx tsx --env-file=.env scripts/privacy-sweep.ts`

```
✓ AuditLog: 100 rows, nothing that looks like a token, a phone or an e-mail
✓ AgentRun: 10 rows, nothing that looks like a token, a phone or an e-mail
✓ Alert: 3 rows, nothing that looks like a token, a phone or an e-mail
✓ Report: 4 rows, nothing that looks like a token, a phone or an e-mail
✓ ChangeSet: 10 rows, nothing that looks like a token, a phone or an e-mail
✓ ChangeItem: 35 rows, nothing that looks like a token, a phone or an e-mail
✓ RuleRun: 5 rows, nothing that looks like a token, a phone or an e-mail
✓ CapiEvent: 199 rows, nothing that looks like a token, a phone or an e-mail
✓ ReviewIssue: 0 rows, nothing that looks like a token, a phone or an e-mail
✓ Lesson: 3 rows, nothing that looks like a token, a phone or an e-mail
✓ Experiment: 1 rows, nothing that looks like a token, a phone or an e-mail
✓ AttributedOrder: 119 rows, nothing that looks like a token, a phone or an e-mail
✓ the sweep is clean
```

### ✅ الأسرار والخصوصية — ولا سر بالكود

`node scripts/scan-secrets.mjs`

```
Secret scan clean - 226 files.
```

### ✅ الأرقام والمنطق — مثال الحقيقة 17.1 حرفياً · المعادلة 17.2 · كل قاعدة · المصفوفة · ChangeSet · CAPI · القاموس · الفلتر · ولا موافقة من تيليجرام

`npx vitest run`

```
 ✓ tests/meta-client.test.ts (6 tests) 34ms
 ✓ tests/capi.test.ts (7 tests) 20ms
 ✓ tests/experiments.test.ts (6 tests) 12ms
 ✓ tests/weekly.test.ts (8 tests) 17ms
 ✓ tests/economics.test.ts (18 tests) 11ms
 ✓ tests/telegram-command.test.ts (4 tests) 11ms
 ✓ tests/scale.test.ts (9 tests) 14ms
 ✓ tests/naming.test.ts (6 tests) 50ms
 ✓ tests/creative.test.ts (8 tests) 21ms
 ✓ tests/account-safety.test.ts (7 tests) 22ms
 ✓ tests/builder.test.ts (13 tests) 36ms
 ✓ tests/gateway.test.ts (14 tests) 46ms
 ✓ tests/rules.test.ts (28 tests) 74ms
 ✓ tests/roles.test.ts (9 tests) 14ms
 ✓ tests/themes-palettes.test.ts (6 tests) 23ms
 ✓ tests/studio-contract.test.ts (8 tests) 30ms
 ✓ tests/upload-drive.test.ts (3 tests) 62ms
 ✓ tests/io.test.ts (7 tests) 115ms
 Test Files  18 passed (18)
      Tests  167 passed (167)
```

### ✅ الأرقام والمنطق — الأنواع

`npx tsc --noEmit`

```

```
