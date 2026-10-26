/**
 * THE LAUNCH (spec 5.3 + 9.1 + T4.1/T4.2) — the wizard's last step. A product, a template and ready creatives become
 * ONE change set of kind `test_campaign` (owner approval at levels 1–2) and ONE test with its hypothesis and stop
 * rules. On approval the change creates everything PAUSED, checks every setting by reading it back, and only then
 * switches it on (src/server/changes.ts). In dry_run nothing reaches Meta: the change records every payload.
 */
import { db } from "./db";
import { HttpError, type Caller } from "./auth";
import { getSetting } from "./settings";
import { propose } from "./changes";
import { can } from "@/core/roles";
import { checkPolicy } from "@/core/policy";
import { estimateTargets } from "@/core/economics";
import { nextFreeCampaignName, parseCampaignName, yymmdd, type Market } from "@/core/naming";
import { launchDailySpend, launchItems, TEMPLATES, type LaunchCreative, type LaunchRequest, type TemplateKey } from "@/core/templates";
import { creativeTestBudget, KIND_AR, stopRulesFor, type ExperimentKind } from "@/core/experiments";
import { guardText } from "@/agents/guard";

export interface LaunchInput {
  template: TemplateKey;
  productCode: string;
  market: Market;
  accountMetaId: string;
  pageMetaId: string;
  datasetMetaId: string;
  landingUrl: string;
  lpCode: string;
  crCodes: string[];
  message: string;
  title: string;
  dailyBudgetUsd?: number;
  spendCapUsd?: number;
  hypothesis?: string;
}

const KIND_OF: Record<TemplateKey, ExperimentKind> = { TEST: "product", CRT: "creative", SCALE: "creative" };
const code = (v: string | null | undefined, re: RegExp, fallback: string) => (v && re.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : fallback);

/** T_order and the ceiling from the product's economics (spec 17.2); the defaults until real numbers arrive. */
export async function productTargets(productCode: string) {
  const e = await db.productEconomics.findUnique({ where: { productCode } });
  if (!e) return null;
  const [C, D, profitMin] = await Promise.all([getSetting("economics.default_C"), getSetting("economics.default_D"), getSetting("economics.profit_min_share")]);
  const t = estimateTargets({ price: e.price.toString(), unitCost: e.unitCost.toString(), shipping: e.deliveryFee.toString(), returnFee: e.returnFee.toString(), codFee: e.codFeePct.toString(), confirmCost: e.confirmCost.toString(), confirmRate: C, deliveryRate: D, profitMinShare: profitMin });
  const tOrder = Number(t.tOrder.toFixed(2));
  const tConfirmed = Number(t.tConfirmed.toFixed(2));
  // before the product has its own truth, the ceiling a test is judged by is the estimated cost per confirmed (17.2)
  return { tOrder, tConfirmed, ceiling: tConfirmed, losing: t.losing };
}

/** Build the request from the database: names, ids, budgets — everything the wizard does not ask the owner. */
export async function prepareLaunch(input: LaunchInput) {
  const problems: string[] = [];
  const page = await db.page.findUnique({ where: { metaId: input.pageMetaId } });
  if (!page?.code) problems.push("الصفحة مش معروفة أو ما إلها رمز (SP · VP · AJ)");
  const account = await db.adAccount.findUnique({ where: { metaId: input.accountMetaId } });
  if (!account) problems.push("الحساب الإعلاني مش معروف");
  const frozen = await db.freeze.findFirst({ where: { targetId: input.accountMetaId, kind: { in: ["create", "all"] }, liftedAt: null, OR: [{ until: null }, { until: { gt: new Date() } }] } });
  if (frozen) problems.push(`الإنشاء مجمّد على هالحساب: ${frozen.reason}`);
  if (!/^LP\d$/.test(input.lpCode)) problems.push("رمز صفحة الهبوط لازم يكون LP ورقم");
  if (!/^https:\/\//.test(input.landingUrl)) problems.push("رابط صفحة الهبوط لازم يبلّش بـ https");

  const assets = await db.creativeAsset.findMany({ where: { crCode: { in: input.crCodes } } });
  for (const cr of input.crCodes) {
    const a = assets.find((x) => x.crCode === cr);
    if (!a) problems.push(`${cr}: مش موجود`);
    else if (!a.metaVideoId) problems.push(`${cr}: لسا ما انرفع لميتا`);
    else if (a.policyFlag === "red" || a.status === "excluded" || a.status === "dead") problems.push(`${cr}: مستبعد (${a.policyNote ?? a.status})`);
    else if (a.productCode && a.productCode !== input.productCode) problems.push(`${cr}: لمنتج تاني (${a.productCode})`);
  }
  const policy = checkPolicy({ "النص": input.message, "العنوان": input.title });
  if (policy.flag === "red") problems.push(`نص الإعلان فيه ممنوع: ${policy.hits.filter((h) => h.level === "red").map((h) => `«${h.text}»${h.alternative ? ` ← «${h.alternative}»` : ""}`).join(" · ")}`);

  const targets = await productTargets(input.productCode);
  if (!targets) problems.push("اقتصاديات المنتج ناقصة — كمّلها بالإعدادات أول");
  else if (targets.losing) problems.push("المنتج خسران بأرقامه الحالية — ما في سقف تكلفة يربح");
  if (problems.length) return { ok: false as const, problems };

  const t = TEMPLATES[input.template];
  const dailyBudgetUsd = input.dailyBudgetUsd ?? (input.template === "SCALE" ? 50 : creativeTestBudget(targets!.tOrder));
  const date = yymmdd(new Date());
  const taken = await db.campaign.findMany({ where: { name: { startsWith: `${input.market}_${input.productCode}_WEB_${t.stage}_${date}_` } }, select: { name: true } });
  const pendingNames = await db.changeItem.findMany({ where: { op: "create", objectType: "campaign", changeSet: { state: { in: ["simulated", "pending_approval", "approved", "executing", "executed", "rolled_back", "failed"] } } }, select: { after: true } });
  const name = nextFreeCampaignName({ market: input.market, productCode: input.productCode, objective: "WEB", stage: t.stage, date }, [...taken.map((c) => c.name), ...pendingNames.map((p) => String((p.after as { name?: string }).name ?? ""))]);
  const seq = parseCampaignName(name)!.seq;

  const settingsMarket = input.market === "SY" ? await getSetting("market.SY") : input.market === "JO" ? await getSetting("market.JO") : null;
  const creatives: LaunchCreative[] = input.crCodes.map((cr) => {
    const a = assets.find((x) => x.crCode === cr)!;
    return {
      crCode: cr,
      videoId: a.metaVideoId!,
      thumbnailHash: a.thumbnailHash,
      hookCode: code(a.hookType, /^H\d{2}$/, "H00"),
      angleCode: code(a.angle, /^[A-Z]{3}$/, "GEN"),
      conceptId: code(a.conceptId, /^CPT\d{4}$/, "CPT0000"),
      message: input.message,
      title: input.title,
    };
  });
  const request: LaunchRequest = {
    template: input.template, market: input.market, productCode: input.productCode, accountId: input.accountMetaId,
    pageId: input.pageMetaId, pageCode: page!.code!, pixelId: input.datasetMetaId, landingUrl: input.landingUrl, lpCode: input.lpCode,
    date, seq, dailyBudgetUsd, spendCapUsd: input.spendCapUsd ?? (input.template === "SCALE" ? undefined : dailyBudgetUsd * new Set(creatives.map((c) => c.conceptId)).size * t.days),
    minAge: settingsMarket?.min_age ?? 18, creatives,
  };
  return { ok: true as const, request, name, targets: targets!, perDay: launchDailySpend(request), policy };
}

/** «أطلق»: the change set waits for the owner (or runs at level 3), the test is written next to it. */
export async function launch(input: LaunchInput, caller: Caller) {
  if (!can(caller.role, "propose_change")) throw new HttpError(403, "دورك ما بيسمح بالإطلاق");
  const prep = await prepareLaunch(input);
  if (!prep.ok) throw new HttpError(422, prep.problems.join(" · "));
  // the guard reads the text once more at the launch itself (dictionary first; the model may only add issues)
  const guard = await guardText({ "النص": input.message, "العنوان": input.title });
  if (guard.verdict !== "pass") throw new HttpError(422, `الحارس: ${guard.issues.map((i) => `«${i.text}» (${i.rule})${i.alternative ? ` ← «${i.alternative}»` : ""}`).join(" · ")}`);
  const { request, name, targets, perDay } = prep;
  const kind = KIND_OF[request.template];
  const concepts = new Set(request.creatives.map((c) => c.conceptId)).size;
  const cs = await propose(
    {
      source: "user",
      sourceRef: caller.id,
      reasonCode: "S11",
      sentence: `إطلاق ${name}: ${concepts} مجموعة · ${request.creatives.length} إعلان · ${perDay}$ باليوم — كله بيبلّش موقّف وبيتفعّل بعد ما يطابق القالب`,
      kind: "test_campaign",
      accountMetaId: request.accountId,
      items: launchItems(request),
    },
    { type: "user", id: caller.id },
  );
  const t = TEMPLATES[request.template];
  const experiment = await db.experiment.create({
    data: {
      kind,
      productCode: request.productCode,
      market: request.market,
      hypothesis: input.hypothesis?.trim() || `${KIND_AR[kind]}: أي مفهوم بيجيب طلب مؤكد تحت ${targets.ceiling}$`,
      setup: { template: request.template, campaign: name, dailyBudgetUsd: request.dailyBudgetUsd, spendCapUsd: request.spendCapUsd ?? null, crCodes: input.crCodes, lpCode: request.lpCode, concepts },
      stopRules: { ...stopRulesFor(kind, { tOrder: targets.tOrder, ceiling: targets.ceiling, days: t.days }) },
      changeSetId: cs.id,
    },
  });
  return { changeSet: cs, experimentId: experiment.id, name, perDay };
}
