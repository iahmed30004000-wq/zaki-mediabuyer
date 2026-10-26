/**
 * Excel export (spec T1.10): the truth per product and per ad, and a sheet that explains every indicator with its
 * formula and source — so the file stands on its own when it is sent to somebody.
 */
import ExcelJS from "exceljs";
import { GLOSSARY, SOURCE_AR } from "@/lib/glossary";

export interface ExportRow {
  level: string;
  name: string;
  spend: number | null;
  orders: number;
  confirmed: number;
  delivered: number;
  costPerConfirmed: number | null;
  ceiling: number | null;
  confirmRate: number | null;
  deliveryRate: number | null;
  profit: number | null;
  roas: number | null;
}

const COLUMNS: { header: string; key: keyof ExportRow; width: number; fmt?: string }[] = [
  { header: "المستوى", key: "level", width: 10 },
  { header: "الاسم", key: "name", width: 34 },
  { header: "الصرف الفعلي $", key: "spend", width: 14, fmt: "0.00" },
  { header: "الطلبات", key: "orders", width: 10 },
  { header: "المؤكد", key: "confirmed", width: 10 },
  { header: "المُسلَّم", key: "delivered", width: 10 },
  { header: "تكلفة المؤكد $", key: "costPerConfirmed", width: 14, fmt: "0.00" },
  { header: "سقف التكبير $", key: "ceiling", width: 14, fmt: "0.00" },
  { header: "نسبة التأكيد", key: "confirmRate", width: 12, fmt: "0.0%" },
  { header: "نسبة التسليم", key: "deliveryRate", width: 12, fmt: "0.0%" },
  { header: "الربح بعد المصاريف $", key: "profit", width: 18, fmt: "0.00" },
  { header: "العائد الحقيقي", key: "roas", width: 12, fmt: "0.00" },
];

export async function buildWorkbook(rows: ExportRow[], title: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Zaki Media Buyer";
  wb.created = new Date();

  const sheet = wb.addWorksheet("الحقيقة", { views: [{ rightToLeft: true, state: "frozen", ySplit: 2 }] });
  sheet.mergeCells(1, 1, 1, COLUMNS.length);
  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  sheet.getRow(2).values = COLUMNS.map((c) => c.header);
  sheet.getRow(2).font = { bold: true };
  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
  for (const r of rows) sheet.addRow(r);

  const help = wb.addWorksheet("شرح المؤشرات", { views: [{ rightToLeft: true }] });
  help.columns = [
    { header: "المؤشر", key: "name", width: 26 },
    { header: "قاعدة الاحتساب", key: "formula", width: 52 },
    { header: "شو بيعني", key: "meaning", width: 60 },
    { header: "المصدر", key: "source", width: 10 },
  ];
  help.getRow(1).font = { bold: true };
  for (const t of Object.values(GLOSSARY)) help.addRow({ name: t.name, formula: t.formula, meaning: t.meaning, source: SOURCE_AR[t.source] });
  help.addRow({});
  help.addRow({ name: "ملاحظة", meaning: "«حقيقي» من الـ OMS (طلبات مؤكدة ومُسلَّمة). «ميتا» للتشغيل اللحظي بس. «تقدير» قبل 50 شحنة حقيقية. نسبة التأكيد على الطلبات الناضجة (مرّ عليها 24 ساعة)." });

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
