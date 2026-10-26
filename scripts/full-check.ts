/**
 * THE FULL CHECK (spec 17.4, T6.2) — every line of the list, in order, on the local database in dry-run, and the
 * evidence written to docs/FULL_CHECK.md. Run before the real ad account is handed over:
 *   `npm run check:full`   (needs the local database and ffmpeg; Meta, the OMS and Telegram are the pretend ones)
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

interface Item {
  section: string;
  what: string;
  cmd: string[];
}

const tsx = (file: string) => ["npx", "tsx", "--env-file=.env", file];
const ITEMS: Item[] = [
  { section: "التحضير", what: "بيانات تجريبية: ميتا والـ OMS الوهميين ← الأرشيف والحقيقة", cmd: tsx("scripts/demo-pipeline.ts") },
  { section: "المسار الكامل", what: "فيديو بـ inbox ← فحص وتسمية ← رفع ← حملة كـ ChangeSet ← موافقة ← إنشاء موقّف ← تحقق ← تفعيل ← طلب برقم الإعلان ← الحقيقة ← قاعدة ← تقرير ← حدث CAPI", cmd: tsx("scripts/full-path.ts") },
  { section: "الأمان", what: "قاعدة الخاسر بتوقف · الإيقاف الكامل · الرجوع · منع اللوب", cmd: tsx("scripts/demo-guard.ts") },
  { section: "الأمان والمال", what: "الإطلاق بموافقة · حساب مقيّد ← صفر · 3 رفض ← تجميد الإنشاء", cmd: tsx("scripts/demo-launch.ts") },
  { section: "الأمان", what: "شبكة الأمان على ميتا: سقف الحساب (الشهري + 10%) وقاعدة إيقاف — بموافقة المالك، وبترجع", cmd: tsx("scripts/demo-safety-net.ts") },
  { section: "المال", what: "سلّم التكبير: المستوى 1 بيستنى، المستوى 2 ضمن السقف · الخطة ضمن السقف", cmd: tsx("scripts/demo-phase5.ts") },
  { section: "التنبيهات", what: "قراءتين ورا بعض قبل التنبيه · الموافقة والأمان فوراً · رسالة تيليجرام وحدة · ولا شي بينبعت مرتين", cmd: tsx("scripts/demo-alerts.ts") },
  { section: "التحويلات", what: "حدث ناجح · منع التكرار · حد الأيام السبعة · ولا معرّف محفوظ", cmd: tsx("scripts/demo-capi.ts") },
  { section: "الإبداعات", what: "مكرر بيتلقط · نص KamaaEye بيتعلّم · الترقيم ما بيتكرر", cmd: tsx("scripts/demo-creatives.ts") },
  { section: "الإبداعات", what: "الرابح المتعب بيتعلّم وما بيوقف · 4 هوكات جديدة بطابور الاستديو · الاستديو بياخدها بتوكنه", cmd: tsx("scripts/demo-fatigue.ts") },
  { section: "الوكلاء", what: "المحلل · الحارس · معدّ التغييرات (بيستنى إنسان دايماً) · الاستراتيجي · المراقب — والكود بيكمّل بلا موديل", cmd: tsx("scripts/demo-agents.ts") },
  { section: "النسخ الاحتياطي", what: "نسخة كاملة ← استرجاع بقاعدة فاضية ← كل جدول مطابق", cmd: tsx("scripts/backup-restore-check.ts") },
  { section: "الأسرار والخصوصية", what: "ولا توكن ولا هاتف ولا إيميل زبون بأي سجل أو تقرير أو قرار", cmd: tsx("scripts/privacy-sweep.ts") },
  { section: "الأسرار والخصوصية", what: "ولا سر بالكود", cmd: ["node", "scripts/scan-secrets.mjs"] },
  { section: "الأرقام والمنطق", what: "مثال الحقيقة 17.1 حرفياً · المعادلة 17.2 · كل قاعدة · المصفوفة · ChangeSet · CAPI · القاموس · الفلتر · ولا موافقة من تيليجرام", cmd: ["npx", "vitest", "run"] },
  { section: "الأرقام والمنطق", what: "الأنواع", cmd: ["npx", "tsc", "--noEmit"] },
];

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const lines: string[] = [];
let failed = 0;
const started = new Date();
for (const it of ITEMS) {
  const t0 = Date.now();
  const r = spawnSync(it.cmd[0]!, it.cmd.slice(1), { encoding: "utf8", shell: process.platform === "win32", timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
  const out = strip(`${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  const marks = out.split("\n").filter((l) => /^\s*[✓✗]/.test(l) || /Tests\s+\d+ passed|Test Files|failed|clean/.test(l)).map((l) => l.trimEnd());
  const ok = r.status === 0 && !marks.some((l) => /^\s*✗/.test(l));
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${it.section} — ${it.what} (${Math.round((Date.now() - t0) / 1000)}s)`);
  lines.push(`### ${ok ? "✅" : "❌"} ${it.section} — ${it.what}`, "", `\`${it.cmd.join(" ")}\``, "", "```", ...(marks.length ? marks.slice(0, 40) : [out.trim().split("\n").slice(-8).join("\n")]), "```", "");
}

const md = [
  "# الفحص الشامل (الـ SPEC 17.4)",
  "",
  `آخر تشغيل: ${started.toISOString().slice(0, 16).replace("T", " ")} UTC · ${ITEMS.length - failed} من ${ITEMS.length} نجح · كله على القاعدة المحلية بوضع dry-run، وميتا والـ OMS وهميين.`,
  "",
  "> بيتعاد بـ `npm run check:full` قبل تسليم الحساب الإعلاني الحقيقي، وبعد أي تغيير كبير. أول حدث CAPI حقيقي بيتجرّب بأداة Test Events عند ميتا (`CAPI_TEST_EVENT_CODE`).",
  "",
  ...lines,
].join("\n");
writeFileSync("docs/FULL_CHECK.md", md);
console.log(failed ? `\n✗ ${failed} item(s) failed — see docs/FULL_CHECK.md` : "\n✓ every item held — docs/FULL_CHECK.md");
process.exit(failed ? 1 : 0);
