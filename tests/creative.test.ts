import { describe, expect, it } from "vitest";
import { aspectOf, crCode, creativeFileName, judgeProbe, thumbnailMoments, type Probe } from "@/core/creative";
import { checkPolicy, policyNote } from "@/core/policy";

const probe = (x: Partial<Probe> = {}): Probe => ({ ok: true, durationS: 24, width: 1080, height: 1920, hasAudio: true, firstFrameBlack: false, ...x });

describe("intake checks (spec 7.2)", () => {
  it("aspects within 3%", () => {
    expect(aspectOf(1080, 1920)).toBe("9:16");
    expect(aspectOf(1080, 1350)).toBe("4:5");
    expect(aspectOf(1080, 1080)).toBe("1:1");
    expect(aspectOf(1920, 1080)).toBeNull();
  });
  it("a good video passes; each problem is said in plain words", () => {
    expect(judgeProbe(probe())).toEqual({ ok: true, aspect: "9:16", problems: [] });
    const bad = judgeProbe(probe({ width: 540, height: 960, hasAudio: false, firstFrameBlack: true }));
    expect(bad.ok).toBe(false);
    expect(bad.problems).toEqual(["الدقة أقل من 720p (540×960)", "ما فيه صوت", "أول إطار أسود — الغلاف الحقيقي بالفيد"]);
  });
  it("numbering and the one name everywhere", () => {
    expect(crCode(147)).toBe("CR00147");
    expect(creativeFileName("KamaaEye", "CR00147", "A3F9C0FFEE")).toBe("KamaaEye_CR00147_a3f9.mp4");
    expect(creativeFileName("TRF 01", "CR00148", "b2c1")).toBe("TRF01_CR00148_b2c1.mp4");
  });
  it("six thumbnail moments inside the first 3 seconds", () => {
    const m = thumbnailMoments(24);
    expect(m).toHaveLength(6);
    expect(m[0]).toBeGreaterThan(0);
    expect(m[5]).toBeLessThanOrEqual(3);
  });
});

describe("the policy guard (spec 8)", () => {
  it("the KamaaEye text is «edit», with its reasons and alternatives (mandatory test case, 8.4)", () => {
    const r = checkPolicy({ adText: "ماء الكمأة الطبيعي. وماؤها شفاءٌ للعين. ليس كل ما يُباع في السوق هو الأصلي، اطلب الآن والدفع عند الاستلام." });
    expect(r.verdict).toBe("edit");
    expect(r.flag).toBe("red");
    expect(r.hits.map((h) => h.ruleId).sort()).toEqual(["competitors", "religious_claim"]);
    expect(policyNote(r)).toContain("الكمأة، مكوّن تراثي معروف من زمان");
  });
  it("«عندك طنين؟» is forbidden, with its alternative (T3.3)", () => {
    const r = checkPolicy({ transcript: "عندك طنين؟ جرب قطرتنا" });
    expect(r).toMatchObject({ flag: "red", verdict: "edit" });
    expect(r.hits[0]!.alternative).toBe("الطنين بيزعج كتير ناس، خصوصاً بالليل");
  });
  it("a cure promise in any spelling, and an age address without an alternative is «block»", () => {
    expect(checkPolicy({ ocrText: "بيشفي الندبات" }).flag).toBe("red");
    expect(checkPolicy({ adText: "إذا عمرك فوق 50 لازم تجربه" }).verdict).toBe("block");
  });
  it("heritage wording needs the owner (yellow); a product-only text is green", () => {
    expect(checkPolicy({ adText: "من وصفات التراث، ضمن روتين يومي" })).toMatchObject({ flag: "yellow", verdict: "pass" });
    expect(checkPolicy({ adText: "عبوة 30 مل، اطلب واستلم وادفع عند الباب" })).toEqual({ flag: "green", verdict: "pass", hits: [] });
  });
});
