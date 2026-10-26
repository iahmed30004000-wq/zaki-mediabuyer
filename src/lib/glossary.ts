/**
 * «ليش؟» — every number on a screen can say what it is, how it is computed and where it comes from
 * (spec 6.1–6.3, written for the owner). The source badge (ميتا · حقيقي · تقدير) opens this.
 */
export type Source = "meta" | "truth" | "estimate";

export const SOURCE_AR: Record<Source, string> = { meta: "ميتا", truth: "حقيقي", estimate: "تقدير" };
export const SOURCE_HINT: Record<Source, string> = {
  meta: "من أرقام ميتا نفسها — للتشغيل اللحظي وقواعد الأمان بس.",
  truth: "من الـ OMS: طلبات حقيقية مؤكدة ومُسلَّمة. هاد الرقم اللي بنقرر عليه.",
  estimate: "تقدير من أرقام المنتج لحد ما يصير في 50 شحنة حقيقية.",
};

export interface Term {
  name: string;
  formula: string;
  /** One line on what to do with it. */
  meaning: string;
  source: Source;
}

export const GLOSSARY = {
  spend: { name: "الصرف الفعلي", formula: "صرف ميتا × (1 + رسوم البطاقة 1%)", meaning: "اللي طلع فعلاً من جيبتك.", source: "meta" },
  cpm: { name: "CPM", formula: "الصرف ÷ الظهور × 1000", meaning: "غلا الظهور. إذا عالي: جمهور ضيق أو إبداع ضعيف.", source: "meta" },
  ctr: { name: "CTR (رابط)", formula: "نقرات الرابط ÷ الظهور × 100", meaning: "أقل من 1% ضعيف · فوق 2% منيح.", source: "meta" },
  hook: { name: "Hook", formula: "مشاهدات 3 ثواني ÷ الظهور × 100", meaning: "هل أول 3 ثواني بتوقّف الناس؟ فوق 30% منيح.", source: "meta" },
  hold: { name: "Hold", formula: "ThruPlays ÷ مشاهدات 3 ثواني × 100", meaning: "هل القصة بتمسك الناس لآخرها؟", source: "meta" },
  cpaPixel: { name: "CPA بكسل", formula: "الصرف ÷ Purchase ميتا", meaning: "رقم ميتا — ما منقرر عليه لحاله.", source: "meta" },
  orders: { name: "الطلبات", formula: "طلبات الـ OMS برقم الإعلان", meaning: "كل الطلبات، حتى الي لسا ما تأكدت.", source: "truth" },
  confirmRate: { name: "نسبة التأكيد", formula: "المؤكد ÷ الطلبات الناضجة × 100", meaning: "الناضج = مرّ عليه 24 ساعة، عشان طلبات الليل ما تظلم الإعلان.", source: "truth" },
  costPerConfirmed: { name: "تكلفة الطلب المؤكد", formula: "الصرف الفعلي ÷ الطلبات المؤكدة", meaning: "الرقم الأهم. لازم يكون تحت سقف التكبير.", source: "truth" },
  deliveryRate: { name: "نسبة التسليم", formula: "المُسلَّم ÷ الشحنات × 100", meaning: "كم من الي انشحن وصل وندفع حقه.", source: "truth" },
  returnRate: { name: "نسبة المرتجع", formula: "المرتجعات ÷ الشحنات × 100", meaning: "فوق 32% بأول 50 شحنة = وقف الاختبار.", source: "truth" },
  ceiling: { name: "سقف التكبير", formula: "(الصافي المحصّل − تكلفة البضاعة) ÷ الشحنات × 0.60", meaning: "إذا تكلفة المؤكد تحته 3 أيام: مؤهّل للتكبير.", source: "truth" },
  profitDelivered: { name: "ربح الطلب المُسلَّم", formula: "(الصافي − البضاعة − الصرف) × 0.97 ÷ المُسلَّم", meaning: "موجب = المنتج رابح فعلاً.", source: "truth" },
  roas: { name: "العائد الحقيقي", formula: "الصافي المحصّل ÷ الصرف الفعلي", meaning: "كل دولار إعلان رجّع كم دولار مصاري.", source: "truth" },
  tOrder: { name: "هدف تكلفة الطلب (T)", formula: "min(M − ربح أدنى، 0.6 × M)", meaning: "قبل 50 شحنة: من سعر المنتج وتكاليفه.", source: "estimate" },
  gap: { name: "فرق ميتا/حقيقي", formula: "(Purchase ميتا − طلبات OMS) ÷ طلبات OMS", meaning: "فوق 20% = في مشكلة تتبع أو إسناد.", source: "truth" },
} satisfies Record<string, Term>;

export type TermKey = keyof typeof GLOSSARY;
