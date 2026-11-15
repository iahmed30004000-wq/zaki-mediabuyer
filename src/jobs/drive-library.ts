/**
 * drive.library (v3 · I) — the owner's «Zaki Production» Drive, read only: which file is which video, which scenario file
 * belongs to which video, and the rows of his register. The owner shares the folder with the service account (Viewer is
 * enough) and puts its id in DRIVE_PRODUCTION_FOLDER_ID; DRIVE_REGISTER_FILE_ID names his register (a CSV or a Sheet) when its
 * name is not the obvious one.
 *
 *   06_الفيديوهات النهائية / <product> / <files>   → a video's `driveFileId`
 *   03_السيناريوهات / (<product> /) <files>         → a video's `scenarioFileId`
 *   the register                                    → JOB · V · product · status · file ids (src/core/drive-library.ts)
 *
 * NOTHING is renamed, moved or deleted in Drive, and a link is only SET WHERE EMPTY in the bank: what the owner or Claude
 * already pushed is never overwritten. A file that fits no video (or two) is counted and its name kept in the run's stats, so
 * the owner can see what was not understood. A product folder the app does not know is said once a day.
 */
import { db } from "@/server/db";
import { getFile, listChildren, readText, type DriveItem, type DriveOptions } from "@/adapters/drive";
import { DRIVE_FOLDERS, linkFiles, parseCsv, planRegister, readRegister, sameName, type LibraryFile, type LibraryVideo, type LinkField } from "@/core/drive-library";
import { normalizeArabic } from "@/core/naming";
import { videoKey } from "@/core/video-board";
import { productOfFolder } from "./creative-intake";

const FOLDER = "application/vnd.google-apps.folder";
const SHEET = "application/vnd.google-apps.spreadsheet";
const isFolder = (f: DriveItem) => f.mimeType === FOLDER;
const first = <T>(list: T[], n = 20) => list.slice(0, n);

export async function syncDriveLibrary(o: DriveOptions, rootId: string, registerFileId?: string | null) {
  const stats = {
    folders: { finals: false, scenarios: false },
    register: "none" as "none" | "read" | "unreadable",
    registerRows: 0,
    created: 0,
    filled: 0,
    videoFiles: 0,
    scenarioFiles: 0,
    linkedVideos: 0,
    linkedScenarios: 0,
    already: 0,
    unmatched: [] as string[],
    ambiguous: [] as string[],
    conflicts: [] as string[],
    unmappedFolders: [] as string[],
    problems: [] as string[],
  };
  const root = await listChildren(o, rootId);
  const finals = root.find((f) => isFolder(f) && sameName(f.name, DRIVE_FOLDERS.finals));
  const scenarios = root.find((f) => isFolder(f) && sameName(f.name, DRIVE_FOLDERS.scenarios));
  stats.folders = { finals: !!finals, scenarios: !!scenarios };
  if (!finals) stats.problems.push(`ما لقيت مجلد «${DRIVE_FOLDERS.finals}» داخل المجلد المشارك`);
  if (!scenarios) stats.problems.push(`ما لقيت مجلد «${DRIVE_FOLDERS.scenarios}» داخل المجلد المشارك`);

  // ── the register: videos the bank does not have yet, and the empty fields of the ones it has ──
  const regFile: DriveItem | null = registerFileId
    ? await getFile(o, registerFileId).catch(() => null)
    : root.find((f) => !isFolder(f) && /سجل|regist/i.test(normalizeArabic(f.name)) && (f.mimeType === SHEET || /csv|text\/plain/.test(f.mimeType) || /\.csv$/i.test(f.name))) ?? null;
  if (regFile) {
    try {
      const reg = readRegister(parseCsv(await readText(o, regFile.id, regFile.mimeType)));
      stats.register = "read";
      stats.registerRows = reg.rows.length;
      stats.problems.push(...first(reg.problems, 10));
      const names = new Map<string, string | null>();
      for (const n of new Set(reg.rows.map((r) => r.product).filter((p): p is string => !!p))) names.set(n, await productOfFolder(n));
      const bank = await db.videoBankItem.findMany({ select: { job: true, vName: true, productCode: true, driveFileId: true, scenarioFileId: true } });
      const plan = planRegister(reg.rows, bank.map((b) => ({ job: b.job, vName: b.vName, product: b.productCode, driveFileId: b.driveFileId, scenarioFileId: b.scenarioFileId })), (n) => names.get(n) ?? null);
      if (plan.unknownProducts.length) stats.problems.push(`منتجات بالسجل ما بعرفها: ${plan.unknownProducts.slice(0, 5).join("، ")} — ضيف اسم بديل من الإعدادات`);
      for (const r of plan.create) {
        await db.videoBankItem.upsert({
          where: { job_vName: { job: r.job, vName: r.vName } },
          create: { job: r.job, vName: r.vName, productCode: r.product!, driveFileId: r.driveFileId, scenarioFileId: r.scenarioFileId, status: r.status ?? "bank", notes: r.notes, source: "drive" },
          update: {},
        });
        stats.created++;
      }
      for (const f of plan.fill) {
        // each field only while it is still empty — a push that landed in between wins
        if (f.data.driveFileId) await db.videoBankItem.updateMany({ where: { job: f.job, vName: f.vName, driveFileId: null }, data: { driveFileId: f.data.driveFileId } });
        if (f.data.scenarioFileId) await db.videoBankItem.updateMany({ where: { job: f.job, vName: f.vName, scenarioFileId: null }, data: { scenarioFileId: f.data.scenarioFileId } });
        stats.filled++;
      }
    } catch (e) {
      stats.register = "unreadable";
      stats.problems.push(`السجل (${regFile.name}) ما انقرا: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
    }
  }

  // ── the files ──
  const unmapped = new Set<string>();
  const productOf = async (folderName: string) => {
    const p = await productOfFolder(folderName);
    if (!p) unmapped.add(folderName);
    return p;
  };
  const videoFiles: LibraryFile[] = [];
  if (finals) {
    for (const f of await listChildren(o, finals.id)) {
      if (isFolder(f)) {
        const product = await productOf(f.name);
        for (const v of await listChildren(o, f.id)) if (v.mimeType.startsWith("video/")) videoFiles.push({ id: v.id, name: v.name, product });
      } else if (f.mimeType.startsWith("video/")) videoFiles.push({ id: f.id, name: f.name, product: null });
    }
  }
  const scenarioFiles: LibraryFile[] = [];
  if (scenarios) {
    for (const f of await listChildren(o, scenarios.id)) {
      if (isFolder(f)) {
        const product = await productOf(f.name);
        for (const s of await listChildren(o, f.id)) if (!isFolder(s)) scenarioFiles.push({ id: s.id, name: s.name, product });
      } else scenarioFiles.push({ id: f.id, name: f.name, product: null });
    }
  }
  stats.videoFiles = videoFiles.length;
  stats.scenarioFiles = scenarioFiles.length;

  // ── link them to the bank, where the bank has nothing yet ──
  const bank = await db.videoBankItem.findMany({ select: { job: true, vName: true, productCode: true, driveFileId: true, scenarioFileId: true } });
  const videos: LibraryVideo[] = bank.map((b) => ({ key: videoKey(b.job, b.vName), job: b.job, vName: b.vName, product: b.productCode, driveFileId: b.driveFileId, scenarioFileId: b.scenarioFileId }));
  const byKey = new Map(bank.map((b) => [videoKey(b.job, b.vName), b]));
  for (const [files, field] of [[videoFiles, "driveFileId"], [scenarioFiles, "scenarioFileId"]] as [LibraryFile[], LinkField][]) {
    const plan = linkFiles(videos, files, field);
    for (const l of plan.links) {
      const b = byKey.get(l.key)!;
      const r =
        field === "driveFileId"
          ? await db.videoBankItem.updateMany({ where: { job: b.job, vName: b.vName, driveFileId: null }, data: { driveFileId: l.fileId } })
          : await db.videoBankItem.updateMany({ where: { job: b.job, vName: b.vName, scenarioFileId: null }, data: { scenarioFileId: l.fileId } });
      if (r.count) {
        if (field === "driveFileId") stats.linkedVideos++;
        else stats.linkedScenarios++;
      }
    }
    stats.already += plan.already;
    stats.unmatched.push(...first(plan.unmatched.map((f) => f.name)));
    stats.ambiguous.push(...first(plan.ambiguous.map((a) => `${a.name} — ${a.reason}`)));
    stats.conflicts.push(...first(plan.conflicts.map((c) => `${c.fileName} (${c.key}): الفيديو مربوط بغيره`)));
  }

  stats.unmappedFolders = [...unmapped];
  if (unmapped.size) {
    const text = `مجلد درايف «${[...unmapped].join("، ")}» ما إله منتج معروف — ضيف اسم بديل للمنتج من الإعدادات وبينربط ملفه لحاله`;
    const dup = await db.alert.findFirst({ where: { kind: "drive.library_unmapped", text, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (!dup) await db.alert.create({ data: { kind: "drive.library_unmapped", tone: "warn", text, href: "/settings#products" } });
  }
  return stats;
}
