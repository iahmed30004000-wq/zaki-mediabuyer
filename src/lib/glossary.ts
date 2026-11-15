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
  realOrders: { name: "الطلبات الحقيقية", formula: "طلبات الـ OMS (هواتف فريدة) بيوم الطلب", meaning: "كل طلب إجا فعلاً، حتى لو لسا ما تأكد.", source: "truth" },
  costPerOrder: { name: "تكلفة الطلب الحقيقي", formula: "الصرف الفعلي (مع رسوم البطاقة) ÷ الطلبات الحقيقية", meaning: "الرقم اللي بنقارنه بنقطة التعادل. أرقام ميتا للتسليم بس.", source: "truth" },
  profitEst: { name: "الربح التقديري", formula: "الطلبات × هامش الطلب المتوقع للمنتج − الصرف الفعلي", meaning: "تقدير لحد ما تتسلّم الشحنات؛ بعدها بيصير حقيقي.", source: "estimate" },
  testShare: { name: "حصة الاختبارات", formula: "صرف حملات الاختبار ÷ كل صرف اليوم", meaning: "الحد 20%: فوقه الاختبارات بتاكل الصرف وتكلفة الحساب بتطلع.", source: "meta" },
  pixelPurchases: { name: "Purchase بالبكسل", formula: "عدد أحداث الشراء اللي سجّلها بكسل ميتا", meaning: "رقم ميتا — بنقارنه بالطلبات الحقيقية، وما بنقرر عليه.", source: "meta" },
  uniqueCustomers: { name: "عملاء فريدين", formula: "عدد الأرقام (الهواتف) المختلفة بين طلبات الفترة", meaning: "نفس الزبون لو طلب مرتين بيتعدّ مرة.", source: "truth" },
  duplicates: { name: "تكرار انحذف", formula: "الطلبات − العملاء الفريدين", meaning: "طلبات مكررة من نفس الزبون — ما بتنحسب بالتكلفة.", source: "truth" },
  costPerDelivered: { name: "تكلفة الطلب المُسلَّم", formula: "الصرف الفعلي ÷ الطلبات المُسلَّمة", meaning: "الكلفة الفعلية لما الطلب يوصل ويندفع.", source: "truth" },
  confirmedN: { name: "المؤكد", formula: "عدد طلبات الفترة اللي اتأكدت", meaning: "طلب اتأكد = الزبون رد وأكّد.", source: "truth" },
  rejectedN: { name: "المرفوض", formula: "عدد طلبات الفترة اللي انرفضت", meaning: "أسبابه الأكتر بتبيّن تحته.", source: "truth" },
  cancelledN: { name: "الملغي", formula: "عدد طلبات الفترة اللي انلغت", meaning: "ملغي ≠ مرفوض: ما بدخل بنسبة التأكيد.", source: "truth" },
  waitingN: { name: "بانتظار التأكيد", formula: "طلبات لسا ما انحسمت وقت القراءة", meaning: "حالة، مش تدفق: آخر قراءة بالفترة.", source: "truth" },
  confirmRateDay: { name: "نسبة التأكيد", formula: "المؤكد ÷ (المؤكد + المرفوض) × 100", meaning: "بتبيّن كم من اللي انحسم اتأكد. (الملغي والمنتظر برّا).", source: "truth" },
  upsell: { name: "نسبة الزيادة (Upsell)", formula: "طلبات العروض اللي فيها قطعتين أو أكتر ÷ كل طلبات العروض × 100", meaning: "كم زبون أخد أكتر من قطعة. بتحتاج تفصيل العروض بعدد القطع.", source: "truth" },
  aov: { name: "متوسط قيمة الطلب", formula: "مجموع قيمة الطلبات ÷ عددها", meaning: "كل ما زاد، تكلفة الطلب المقبولة بتزيد.", source: "truth" },
  shippedOrders: { name: "طلبات انشحنت", formula: "عدد الطلبات اللي خرجت بالشحن بالفترة", meaning: "بيوم شحنها، مش يوم إجتها.", source: "truth" },
  shippedPieces: { name: "قطع انشحنت", formula: "مجموع الكمية (quantity) للطلبات اللي انشحنت", meaning: "اللي طلع من المخزن فعلاً.", source: "truth" },
  outForDelivery: { name: "خارجة للتوصيل", formula: "طلبات مع المندوب وقت القراءة", meaning: "حالة: آخر قراءة بالفترة.", source: "truth" },
  deliveredN: { name: "المُسلَّم", formula: "عدد الطلبات اللي وصلت وانتحصّلت بالفترة", meaning: "بيوم التسليم.", source: "truth" },
  returnedN: { name: "المرتجع", formula: "عدد الطلبات اللي رجعت بالفترة", meaning: "بيوم رجوعها.", source: "truth" },
  stuckN: { name: "عالق أكتر من 7 أيام", formula: "طلبات انشحنت من أكتر من 7 أيام وما انحسمت (لا تسليم ولا مرتجع)", meaning: "كل واحد منهم بدو متابعة مع الشحن.", source: "truth" },
  deliveryRate30: { name: "نسبة التسليم (30 يوم)", formula: "المُسلَّم ÷ (المُسلَّم + المرتجع) آخر 30 يوم للمنتج × 100", meaning: "نسبة اللي وصل من اللي انحسم. اللي لسا بالطريق برّا.", source: "truth" },
  expectedRevenue: { name: "الإيراد المتوقع", formula: "مجموع totalAmount للطلبات اللي انشحنت × نسبة تسليم المنتج آخر 30 يوم", meaning: "كم رح ينحصّل من شحنات الفترة لو انسلّم بنفس النسبة.", source: "estimate" },
  expectedShipping: { name: "الشحن المتوقع", formula: "طلبات الشحن × أجرة التوصيل + طلبات الشحن × (1 − نسبة التسليم) × أجرة الإرجاع", meaning: "من أرقام المنتج بالإعدادات.", source: "estimate" },
  expectedProfit: { name: "الربح المتوقع", formula: "الإيراد المتوقع − (القطع المشحونة × نسبة التسليم × تكلفة القطعة) − الشحن المتوقع − الصرف الفعلي", meaning: "ربح شحنات الفترة بعد الإعلان. تقدير لحد ما تنحسم.", source: "estimate" },
  stockUnits: { name: "القطع الباقية", formula: "المخزون وقت آخر قراءة", meaning: "من آخر ما انبعت.", source: "truth" },
  stockCover: { name: "أيام التغطية", formula: "القطع الباقية ÷ متوسط القطع المشحونة باليوم (آخر 7 أيام)", meaning: "🔴 أقل من 7 · 🟠 7–10 · 🟡 10–14 (القواعد).", source: "estimate" },
  gap: { name: "فرق ميتا/حقيقي", formula: "(Purchase ميتا − طلبات OMS) ÷ طلبات OMS", meaning: "فوق 20% = في مشكلة تتبع أو إسناد.", source: "truth" },
  // the ads table (v3 · C)
  pageCode: { name: "الصفحة", formula: "رمز صفحة الهبوط من اسم المجموعة (SP · VP · AJ…) — للحملة: رموز مجموعاتها", meaning: "أي صفحة بتنزّل عليها الإعلانات.", source: "meta" },
  daysRunning: { name: "أيام التشغيل", formula: "من يوم بداية الصرف (start_time) لليوم؛ اليوم الأول بيحسب يوم 1 (توقيت عمّان)", meaning: "قاعدة الاختبار: ما منحكم على اليوم الأول، وبعد 3 أيام بيجي القرار.", source: "meta" },
  budgetDaily: { name: "الميزانية اليومية", formula: "ميزانية المجموعة بالدولار (أو الحملة إذا كانت CBO)", meaning: "السقف اليومي اللي حاطه ميتا للعنصر. أي زيادة عليه بموافقتك.", source: "meta" },
  spendTY: { name: "الصرف اليوم / أمس", formula: "صرف ميتا × (1 + رسوم البطاقة 1%) ليوم عمّان الحالي ثم لليوم اللي قبله", meaning: "بيبيّن إذا الصرف عم يتسارع أو يتباطأ مقابل أمس.", source: "meta" },
  frequency: { name: "التكرار", formula: "معدّل مرات ما شاف الشخص الواحد الإعلان — مرجّح بالظهور على أيام الفترة", meaning: "لما يعلى (حدّ تعب الإبداع بالقواعد) الجمهور بدأ يملّ.", source: "meta" },
  adsCount: { name: "عدد الإعلانات", formula: "الإعلانات تحت العنصر (للحملة: إعلانات كل مجموعاتها)", meaning: "إعلانات كتيرة بمجموعة وحدة بتوزّع الصرف وبتأخّر الحكم.", source: "meta" },
  // the videos board (v3 · D)
  bankCount: { name: "البنك", formula: "عدد فيديوهات المنتج اللي مش مستبعدة (بالبنك · جاهز · مرفوع · بالتجربة · رابح · تعبان) مقابل الهدف 50", meaning: "تحت 50: المنتج بدو فيديوهات جديدة — هوكات على الرابحين وسيناريوهات.", source: "truth" },
  minSpend: { name: "حد الترتيب", formula: "اللي كتبته إنت بالدولار؛ وإذا فاضي: ضعف هدف تكلفة الطلب للمنتج", meaning: "فيديو صرف أقل منه بآخر 7 أيام ما بيتصنّف رابح — طلب رخيص من صرف قليل حظ مش نتيجة.", source: "estimate" },
} satisfies Record<string, Term>;

export type TermKey = keyof typeof GLOSSARY;
