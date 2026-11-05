# الفحص الشامل (الـ SPEC 17.4)

آخر تشغيل: 2026-11-05 21:02 UTC · 17 من 17 نجح · كله على القاعدة المحلية بوضع dry-run، وميتا والـ OMS وهميين.

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
✓  1. video in 01_inbox → ready as TRF01_CR00040_03bf.mp4
✓  2. checked and named: policy green, 6 thumbnails
✓  3. upload → dry_run (stand-in video id dry_v_CR00040)
✓  4. campaign SY_TRF01_WEB_CRT_261106_C03 as one ChangeSet → waits for approval (+15$/day)
✓  5. approved on the site → executed
✓  6. created PAUSED and verified against the template
✓  7. switched on only after the check
✓  8. 6 OMS orders tied to CR00040_H07_HER_LP1 by its ad id
✓  9. the truth: 4 confirmed, 3.74$ per confirmed (spend × 1.01 ÷ mature confirmed)
✓ 10. the rules: not a loser · the ladder: ما ثبت 3 أيام ورا بعض تحت السقف 6.23$ (— · — · 3.74)
✓ 11. the morning report lists CR00040 among the best ads
✓ 12. CAPI: Purchase for order PATH-CR00040-0 → sent (against the pretend Meta)
```

### ✅ الأمان — قاعدة الخاسر بتوقف · الإيقاف الكامل · الرجوع · منع اللوب

`npx tsx --env-file=.env scripts/demo-guard.ts`

```
✓ 1. the loser was paused by the rule (state executed, S01) — «وقّفت الإعلان لأنه صرف 24.24$ (2 × هدف الطلب 4.05$) بـ 333 ساعة بلا ولا طلب.»
✓    …in dry-run: recorded what it would send, sent nothing
✓    …and the rule run is logged once
✓    …a second run inside the cooldown does nothing again
✓ 2. a raise at level 1 waits for approval (state pending_approval, +8$/day)
✓ 4a. «رجّع» resumed the ad with a new change and marked the original rolled_back
✓ 4b. pause → resume → pause in 48 h: frozen and sent to the owner (loop guard)
✓ 3. the kill switch paused 14 campaigns at once (state executed)
✓    …every step is in the audit log
```

### ✅ الأمان والمال — الإطلاق بموافقة · حساب مقيّد ← صفر · 3 رفض ← تجميد الإنشاء

`npx tsx --env-file=.env scripts/demo-launch.ts`

```
✓ 1. «SY_TRF01_WEB_CRT_261106_C02» waits for the owner (pending_approval) · 30$/day
✓    …with its test: «اختبار إبداعات: أي مفهوم بيجيب طلب مؤكد تحت 6.23$»
✓ 2. approved → executed (15 items, dry-run)
✓    …everything created PAUSED, in order
✓    …each creative opts out of all 43 enhancements by name
✓    …the ad points at the ad set and creative made just before it
✓    …and switched on last: ads → ad sets → campaign
✓ 3. the test is running until 2026-11-09
✓    …«رجّع» paused the 6 objects it switched on (creatives stay, nothing deleted)
✓    …and its test stopped with it
✓ 4. forbidden claim refused: نص الإعلان فيه ممنوع: «بيشفي» ← «تُستعمل ضمن روتين العناية اليومي»
✓    …a video not on Meta yet refused: CR00001: لسا ما انرفع لميتا
✓ 5a. restricted account → level 0: even a safety pause is only suggested (simulated)
✓ 5b. 3 rejections in 24 h: creation frozen, 3 appeal drafts written (sent by a person only)
✓    …and the next launch is refused: الإنشاء مجمّد على هالحساب: 3 إعلانات انرفضت خلال 24 ساعة — جمّدت الإنشاء 24 ساعة
✓ 6. attribution: weak · 100% tied by ad id · 4 campaign gap(s) — worst JO_NFG01_WEB_TEST_261019_C01 -40%
```

### ✅ الأمان — شبكة الأمان على ميتا: سقف الحساب (الشهري + 10%) وقاعدة إيقاف — بموافقة المالك، وبترجع

`npx tsx --env-file=.env scripts/demo-safety-net.ts`

```
✓ 1. prepared, waits for the owner even at level 2: «شبكة الأمان على ميتا (حساب سوريا): سقف صرف الحساب عند ميتا 9900$ (الشهري + 10%) · قاعدة جوّا ميتا بتوقف أي مجموعة صرفت 5.00$ اليوم بلا ولا نتيجة — بتشتغل حتى لو نظامنا وقف»
✓    …an ads manager cannot approve it: «هالقرار بدو المالك»
✓ 2. approved → recorded: account cap 9900$ (9000 + 10%), in dollars as Meta takes it
✓    …and the rule: pause an ad set that spent > 500 cents today with no result
✓ 3. «رجّع»: the cap goes back, the rule is switched off (nothing deleted)
```

### ✅ المال — سلّم التكبير: المستوى 1 بيستنى، المستوى 2 ضمن السقف · الخطة ضمن السقف

`npx tsx --env-file=.env scripts/demo-phase5.ts`

```
✓ 0. the ladder: كبّرت المجموعة 30.00$ ← 36.00$ باليوم: 3 أيام تحت السقف 6.23$ (آخر يوم 3.16$ للمؤكد، 24 مؤكد ناضج).
✓ 1a. level 1: the raise waits for you (pending_approval, +6$/day)
✓ 1b. level 2: raised on its own 30$ → 36$ (executed, dry-run)
✓    …and not again today: بمرحلة التعلّم: آخر تعديل جوهري قبل أقل من ساعة (بدنا 72) | انرفعت اليوم خلص | آخر زيادة قبل أقل من ساعة (بدنا 48)
✓ 2. level 2 needs two weeks of decisions; level 3 is off
✓ 3a. the week's plan: 192.8$ a day in 3 lines, inside the caps (written by code)
✓ 3b. weekly report built by code (1383 chars, 4 lesson(s) kept)
✓    …and the monthly one with the system's accuracy (1385 chars)
✓ 4. the consultant (code): 12 facts, every number tagged, no customer data
```

### ✅ التنبيهات — قراءتين ورا بعض قبل التنبيه · الموافقة والأمان فوراً · رسالة تيليجرام وحدة · ولا شي بينبعت مرتين

`npx tsx --env-file=.env scripts/demo-alerts.ts`

```
✓ 1. first reading (6 signals): the waiting approval at once, the weak attribution not yet
✓ 2. second reading (1 raised): the weak attribution now — and the same approval not twice (1)
✓    …a third reading raises nothing again
✓ 3. one Telegram message with 6 alerts:
✓    …and nothing is sent twice
```

### ✅ التحويلات — حدث ناجح · منع التكرار · حد الأيام السبعة · ولا معرّف محفوظ

`npx tsx --env-file=.env scripts/demo-capi.ts`

```
✓ 1. 272 events queued from 192 orders · a second run queued 0
✓ 2. 38 event(s) older than 7 days marked expired, never sent
✓ 3. sent 136 · skipped 98 · rejected 0
✓    …and the database holds only Meta's answer (no phone, no click id, no hash)
✓    …a second send sends nothing
```

### ✅ الإبداعات — مكرر بيتلقط · نص KamaaEye بيتعلّم · الترقيم ما بيتكرر

`npx tsx --env-file=.env scripts/demo-creatives.ts`

```
✓ good video → ready TRF01_CR00041_be27.mp4
✓    …9:16, 6 candidate thumbnails
✓    …named {PRODUCT}_CR#####_{md5}.mp4
✓ its copy → duplicate of CR00041
✓ 540p, no sound, black start → review: فحص الملف: الدقة أقل من 720p (540×960) · ما فيه صوت · أول إطار أسود — الغلاف الحقيقي بالفيد
✓ the KamaaEye text → excluded
✓    …numbers never repeat: CR00041, CR00042, CR00043
```

### ✅ الإبداعات — الرابح المتعب بيتعلّم وما بيوقف · 4 هوكات جديدة بطابور الاستديو · الاستديو بياخدها بتوكنه

`npx tsx --env-file=.env scripts/demo-fatigue.ts`

```
✓ 1. tired winner → «متعب» and still running: متعب: التكرار 2.9 فوق 2.5 · النقر نزل 35% عن أول أيامه · تكلفة الطلب طلعت 48%
✓ 2. queued for the studio: 4 new hooks on VP-TRF01-0050-v1 (1 request)
✓    …a second run asks nothing more while one is open
✓ 3. the studio reads it (vp:read): new_hooks · CR09500 رابح بس تعب: التكرار 2.9 فوق 2.5 · النقر نزل 35% عن أول أيامه · تكلفة الطلب طلعت 48%
✓    …a read token cannot claim (403)
✓ 4. claimed for 2 hours (200); a second claim is refused (409)
✓ 5. the result handed back → done, and the owner is told
```

### ✅ الاستوديو — رفع فيديو حقيقي (بصمة · حجم · توكن) ← طلب واحد حتى لو انبعت مرتين ← الفحص العادي ← الحالة من السجل ← إلغاء مرة وحدة · حقائق المنتج بالمعروف بس · توكن الاستوديو ما بيوافق على شي

`npx tsx --env-file=.env scripts/demo-studio-launch.ts`

```
✓ 1. a real video made: 4774 KB, sha256 9fc7700d23c4…
✓ 2. no token → 401 unauthorized
✓    …a vp:read token → 403 forbidden
✓    …a 700 MB upload is refused up front (422 video_too_large)
✓ 3. wrong checksum → 422 checksum_mismatch
✓    …a meta with missing parts → 422 invalid_meta
✓    …a product we do not know → 422 invalid_meta
✓    …and none of those left a file behind
✓ 4. valid upload → 200 received (88c3cda6-920d-43c0-9651-fb66f05dc2cb)
✓ 5. the same request again → 200 with the same request_id
✓    …the same script with another checksum → 409 duplicate_request
✓    …exactly one request row
✓ 6. worker ran ({"processed":1,"linked":0,"duplicates":0,"broken":0,"failed":0}) → preparing — in dry-run the Meta upload is not sent, so the creative stays «ready» without a video id → «preparing» is the right answer
✓    …registered as CR00044 (ready, policy green), product TRF01, the stored file removed
✓    …reading without a token → 401
✓    …an unknown request → 404 not_found
✓    …the body has exactly the contract's keys
✓ 7. cancel with a read token → 403
✓    …cancel → 200 cancelled
✓    …cancel again → 409 cannot_cancel
✓    …and the status now reads cancelled
✓    …after it ended, the same script can be sent again (a new request)
✓ 8. product-market TRF01/SY → {"price":{"amount":20,"currency":"USD"},"country":"SY","cod":true,"delivery":{"fee":2.5}} (no offer_tiers, no guarantee)
✓    …the alias path answers the same body
✓    …an unknown product → 404 not_found
✓    …no token → 401
✓ 9. a vp:launch token on /api/changes/<id> (approval) → the middleware answers 401, not 200 — the site's approval needs a person's session
```

### ✅ الوكلاء — المحلل · الحارس · معدّ التغييرات (بيستنى إنسان دايماً) · الاستراتيجي · المراقب — والكود بيكمّل بلا موديل

`npx tsx --env-file=.env scripts/demo-agents.ts`

```
✓ 1. M02: 4 products diagnosed (0 weak), by code — e.g. TRF01: مرتجع عالي — توقعات الزبون غير الواقع
✓ 2. M05: the forbidden claim → edit (dictionary); a clean text → pass (dictionary)
✓ 3. M04: the model gave nothing valid — refused cleanly: «M04 failed on every provider: fetch failed»
✓ 4. M06: 0 new-script request(s) with the winning tags (by code); a second run the same week adds none
✓ 5. M01 on «كبّرت المجموعة 30.00$ ← 36.00$ باليوم: 3 أيام تحت السقف 6.23…»: no answer — nothing changes
```

### ✅ النسخ الاحتياطي — نسخة كاملة ← استرجاع بقاعدة فاضية ← كل جدول مطابق

`npx tsx --env-file=.env scripts/backup-restore-check.ts`

```
✓ backup: 42 tables, 1603 rows, migration 20261105120000_studio_launch_requests
✓ restore into an empty database: 1603 rows, every table matches the manifest
✓ a second restore into the same (now full) database is refused: «the target database is not empty (AuditLog) — restore goes into an empty one»
✓ the restored database answers: 15 change sets, 192 orders
```

### ✅ الأسرار والخصوصية — ولا توكن ولا هاتف ولا إيميل زبون بأي سجل أو تقرير أو قرار

`npx tsx --env-file=.env scripts/privacy-sweep.ts`

```
✓ AuditLog: 273 rows, nothing that looks like a token, a phone or an e-mail
✓ AgentRun: 68 rows, nothing that looks like a token, a phone or an e-mail
✓ Alert: 11 rows, nothing that looks like a token, a phone or an e-mail
✓ Report: 8 rows, nothing that looks like a token, a phone or an e-mail
✓ ChangeSet: 15 rows, nothing that looks like a token, a phone or an e-mail
✓ ChangeItem: 49 rows, nothing that looks like a token, a phone or an e-mail
✓ RuleRun: 7 rows, nothing that looks like a token, a phone or an e-mail
✓ CapiEvent: 272 rows, nothing that looks like a token, a phone or an e-mail
✓ ReviewIssue: 0 rows, nothing that looks like a token, a phone or an e-mail
✓ Lesson: 13 rows, nothing that looks like a token, a phone or an e-mail
✓ Experiment: 1 rows, nothing that looks like a token, a phone or an e-mail
✓ AttributedOrder: 192 rows, nothing that looks like a token, a phone or an e-mail
✓ the sweep is clean
```

### ✅ الأسرار والخصوصية — ولا سر بالكود

`node scripts/scan-secrets.mjs`

```
Secret scan clean - 297 files.
```

### ✅ الأرقام والمنطق — مثال الحقيقة 17.1 حرفياً · المعادلة 17.2 · كل قاعدة · المصفوفة · ChangeSet · CAPI · القاموس · الفلتر · ولا موافقة من تيليجرام

`npx vitest run`

```
 ✓ tests/capi.test.ts (7 tests) 7ms
 ✓ tests/economics.test.ts (21 tests) 10ms
 ✓ tests/scale.test.ts (9 tests) 5ms
 ✓ tests/creative.test.ts (8 tests) 7ms
 ✓ tests/meta-client.test.ts (6 tests) 16ms
 ✓ tests/account-safety.test.ts (7 tests) 9ms
 ✓ tests/weekly.test.ts (8 tests) 7ms
 ✓ tests/safety-net.test.ts (4 tests) 10ms
 ✓ tests/builder.test.ts (13 tests) 14ms
 ✓ tests/gateway.test.ts (14 tests) 21ms
 ✓ tests/replies.test.ts (11 tests) 22ms
 ✓ tests/rules.test.ts (29 tests) 41ms
 ✓ tests/roles.test.ts (11 tests) 43ms
 ✓ tests/oms-contract.test.ts (10 tests) 42ms
 ✓ tests/studio-contract.test.ts (11 tests) 74ms
 ✓ tests/upload-drive.test.ts (3 tests) 53ms
 ✓ tests/alerts.test.ts (5 tests) 14ms
 ✓ tests/naming.test.ts (6 tests) 47ms
 ✓ tests/import.test.ts (5 tests) 17ms
 ✓ tests/experiments.test.ts (6 tests) 10ms
 ✓ tests/fatigue.test.ts (4 tests) 9ms
 ✓ tests/telegram-command.test.ts (4 tests) 7ms
 ✓ tests/themes-palettes.test.ts (6 tests) 10ms
 ✓ tests/agents.test.ts (6 tests) 36ms
 ✓ tests/studio-launch.test.ts (19 tests) 1113ms
   ✓ multipart: streamed to disk, limited while reading > reads the file and the meta whatever the chunk size, with the right sha256 1064ms
 ✓ tests/io.test.ts (7 tests) 64ms
 Test Files  26 passed (26)
      Tests  240 passed (240)
```

### ✅ الأرقام والمنطق — الأنواع

`npx tsc --noEmit`

```

```
