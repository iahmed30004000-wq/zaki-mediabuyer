/**
 * M07 — the ad copy writer (spec 11.2 / 11.4), on request from the launch wizard. Variants in the market's dialect,
 * from the allowed claims only; every variant then passes the policy dictionary (the code's M05): a red one is never
 * offered, a yellow one is marked «بدها موافقتك».
 */
import { z } from "zod";
import { ask } from "@/gateway";
import { checkPolicy, policyNote } from "@/core/policy";

const Variants = z.object({
  variants: z.array(z.object({ hook: z.string().max(200), body: z.string().max(1200), headline: z.string().max(120), cta: z.string().max(60), angle: z.string().max(60) })).min(1).max(6),
});

export interface WrittenVariant {
  hook: string;
  body: string;
  headline: string;
  cta: string;
  angle: string;
  flag: "green" | "yellow";
  note: string | null;
}

const DIALECT: Record<string, string> = { SY: "سوري", JO: "أردني", EG: "مصري", SA: "سعودي", LY: "ليبي", MR: "حساني" };

export async function writeVariants(i: { productName: string; market: string; angle?: string; count?: number }): Promise<{ variants: WrittenVariant[]; dropped: number }> {
  const out = await ask("M07", [
    {
      role: "user",
      content: [
        `اكتب ${i.count ?? 3} نسخ إعلان لـ «${i.productName}» باللهجة ${DIALECT[i.market] ?? "الشامية"}${i.angle ? `، الزاوية: ${i.angle}` : ""}. الدفع عند الاستلام.`,
        "القيود: ولا «مضمون» ولا «علاج» ولا «شفاء» ولا وعد بنتيجة ولا قبل/بعد. ولا مخاطبة الزبون بحالته («عندك …؟»). جمل قصيرة.",
        `رجّع JSON: {"variants":[{"hook":"…","body":"…","headline":"…","cta":"…","angle":"…"}]}`,
      ].join("\n"),
    },
  ], Variants);
  let dropped = 0;
  const variants: WrittenVariant[] = [];
  for (const v of out.variants) {
    const r = checkPolicy({ "الخطّاف": v.hook, "النص": v.body, "العنوان": v.headline });
    if (r.flag === "red") {
      dropped++;
      continue;
    }
    variants.push({ ...v, flag: r.flag, note: policyNote(r) });
  }
  return { variants, dropped };
}
