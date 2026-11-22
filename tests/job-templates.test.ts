/**
 * The six templates of «من قالب» (v6 · P4-1): each is a draft that is half built — good enough to save once the owner picks a person where it asks for one, and never in the past.
 */
import { describe, expect, it } from "vitest";
import { ammanInstant } from "@/core/dates";
import { draftToJob, suggestName, validateDraft } from "@/core/job-draft";
import { JOB_TEMPLATES, TEMPLATE_KEYS, templateDraft } from "@/core/job-templates";
import { PEOPLE } from "@/core/tasks";

const NOW = new Date("2026-11-22T10:00:00.000Z"); // Sunday 13:00 on the Amman clock

describe("the six templates", () => {
  it("there are six, in the order of the tiles, with a title and a line each", () => {
    expect(JOB_TEMPLATES.map((t) => t.key)).toEqual([...TEMPLATE_KEYS]);
    expect(JOB_TEMPLATES.map((t) => t.title)).toEqual(["جولة بموعد", "فحص وتنبيه", "مراقبة لفترة", "تقرير يومي", "تذكير شخص", "طلب فيديوهات"]);
    for (const t of JOB_TEMPLATES) expect(t.hint.length, t.key).toBeGreaterThan(5);
  });

  it("every one is a sound draft (the person it asks for chosen), with a name from its first step", () => {
    for (const t of JOB_TEMPLATES) {
      const d = t.build(NOW);
      const sound = { ...d, assigneeKey: d.assigneeKey || "member1" };
      expect(validateDraft(sound, NOW), t.key).toEqual({ ok: true });
      expect(d.name, t.key).toBe(suggestName(d.steps));
      expect(d.name.length, t.key).toBeGreaterThan(3);
      expect(() => draftToJob(sound, NOW), t.key).not.toThrow();
    }
  });

  it("the one for a person leaves the person to the owner: nothing is guessed, so it cannot be saved by mistake", () => {
    const d = templateDraft("remind", NOW)!;
    expect(d.assigneeKey).toBe("");
    expect(validateDraft(d, NOW)).toMatchObject({ ok: false, field: "assigneeKey" });
    expect(d.when).toEqual({ kind: "once", date: "2026-11-23", time: "10:00" });
  });

  it("the one for a period ends today, or tomorrow when today is about to end — never in the past", () => {
    const at = (d: Date) => templateDraft("watch", d)!.when;
    expect(at(NOW)).toMatchObject({ kind: "window", everyHours: 2, until: ammanInstant("2026-11-22", "23:59")!.toISOString() });
    // 23:45 on the Amman clock: the end of today is a quarter of an hour away, so the period is tomorrow's
    const late = ammanInstant("2026-11-22", "23:45")!;
    expect(at(late)).toMatchObject({ until: ammanInstant("2026-11-23", "23:59")!.toISOString() });
  });

  it("the fixed ones: a daily round at 09:30, the report at 21:00, the video request starts now and waits for the owner's yes", () => {
    expect(templateDraft("round", NOW)!.when).toEqual({ kind: "daily", time: "09:30" });
    expect(templateDraft("daily_report", NOW)!.when).toEqual({ kind: "daily", time: "21:00" });
    const v = templateDraft("videos", NOW)!;
    expect(v.when).toEqual({ kind: "now" });
    expect(v.steps.map((s) => s.verb)).toEqual(["ask", "wait_me", "tell"]);
  });

  it("the round's «no» skips the doing and goes to the telling; the check ends there when nothing is under the limit", () => {
    const r = templateDraft("round", NOW)!;
    expect(r.steps[1]).toMatchObject({ verb: "decide", elseGoto: 3 });
    expect(templateDraft("check", NOW)!.steps[1]).toEqual({ verb: "decide", text: "إذا منتج تحت حد الأمان" });
  });

  it("an unknown key is no template; every call gives a new draft (the owner's changes never reach the next one)", () => {
    expect(templateDraft("nope", NOW)).toBeNull();
    const a = templateDraft("round", NOW)!;
    a.steps.push({ verb: "read", text: "x" });
    expect(templateDraft("round", NOW)!.steps).toHaveLength(4);
  });

  it("no number of the owner's, no rule of his and no name of a person is written in a template", () => {
    const all = JSON.stringify(JOB_TEMPLATES.map((t) => t.build(NOW)));
    expect(all).not.toMatch(/\$|%|دولار|دينار/);
    // the people the code knows by name (the agents are not people: «هيرمز» is a doer a template may name)
    for (const p of PEOPLE.filter((x) => !["hermes", "muse", "claude"].includes(x.key))) for (const name of [p.label, ...p.names]) expect(all, name).not.toContain(name);
  });
});
