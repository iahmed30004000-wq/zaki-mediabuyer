import { describe, expect, it } from "vitest";
import { can } from "@/core/roles";
import { fromAdvice, fromApproval, fromChange, fromHandoff, fromOrder, handoffNeedsOwner, inboxCount, inboxHref, itemId, kindOfApproval, sortInbox, splitItemId, type ApprovalIn, type ChangeIn, type HandoffIn } from "@/core/inbox";

const change = (over: Partial<ChangeIn> = {}): ChangeIn => ({ id: "c1", state: "pending_approval", by: "قاعدة التكبير", reasonCode: "S12", sentence: "نزيد الميزانية 20%", target: "X", before: "40$ باليوم", after: "48$ باليوم", spendDeltaDaily: 8, atIso: "2026-11-16T08:00:00.000Z", ...over });
const approval = (over: Partial<ApprovalIn> = {}): ApprovalIn => ({
  id: "a1", title: "ارفع سقف الحساب", why: "الأداء ممتاز", numbers: [{ label: "التكلفة", value: "4$" }], options: [{ key: "approve", label: "وافق" }, { key: "reject", label: "ارفض" }],
  amount: 50, urgency: "orange", kind: null, source: "mcp", workflowKey: null, expiresAt: null, postponedUntil: null, createdAt: "2026-11-16T07:00:00.000Z", ...over,
});
const handoff = (over: Partial<HandoffIn> = {}): HandoffIn => ({ id: "h1", workflowKey: "daily-check", workflowName: "الفحص اليومي", kind: "node_failed", title: "ما قدر يقرا ميتا", assignee: "claude", createdAt: "2026-11-16T05:00:00.000Z", waitingMin: 45, context: { lastError: "timeout" }, ...over });

describe("the three sources become one item", () => {
  it("a Meta change: yes or no (and «جرّب أول» opens it) — it is never postponed", () => {
    const i = fromChange(change());
    expect(i.id).toBe("change:c1");
    expect(i.kind).toBe("spend");
    expect(i.domain).toBe("ads");
    expect(i.actions.map((a) => a.key)).toEqual(["approve", "reject", "open"]);
    expect(i.actions[0]!.variant).toBe("primary");
    expect(i.effect).toMatchObject({ moneyDeltaDaily: 8 });
    expect(i.actions.some((a) => a.key === "later")).toBe(false);
  });

  it("a launch and a safety-net change are their own kinds; money out is orange, a cut is quiet", () => {
    expect(fromChange(change({ launch: true })).kind).toBe("launch");
    expect(fromChange(change({ auto: true })).kind).toBe("safety_net");
    expect(fromChange(change({ spendDeltaDaily: -6 })).urgency).toBe("yellow");
    expect(fromChange(change({ spendDeltaDaily: 20 })).urgency).toBe("orange");
    expect(fromChange(change({ live: false })).demo).toBe(true);
    expect(fromChange(change()).demo).toBeUndefined();
  });

  it("a request from Claude: its options are the answers (the first is the main one) and «أجّل» is always there", () => {
    const i = fromApproval(approval({ options: [{ key: "a", label: "ارفع" }, { key: "b", label: "خلّيه" }] }));
    expect(i.id).toBe("approval:a1");
    expect(i.actions.map((a) => a.label)).toEqual(["ارفع", "خلّيه", "أجّل"]);
    expect(i.actions.map((a) => a.variant)).toEqual(["primary", "secondary", "ghost"]);
    expect(i.from?.label).toBe("Claude");
    expect(i.effect).toMatchObject({ moneyAfter: 50 });
  });

  it("the kind of a request: a message, stock, money, or anything else", () => {
    expect(kindOfApproval({ kind: "send_message", amount: null })).toBe("message");
    expect(kindOfApproval({ kind: "stock", amount: null })).toBe("stock");
    expect(kindOfApproval({ kind: null, amount: 10 })).toBe("spend");
    expect(kindOfApproval({ kind: "cap_raise", amount: null })).toBe("other");
  });

  it("a message waits for «ابعت» and shows the text — the site never sends it", () => {
    const i = fromApproval(approval({ kind: "send_message", amount: null, options: [{ key: "approve", label: "ابعت" }, { key: "reject", label: "لا" }], analysis: { text: "أهلاً، طلبك بالطريق" } }));
    expect(i.kind).toBe("message");
    expect(i.preview).toBe("أهلاً، طلبك بالطريق");
    expect(i.actions[0]).toMatchObject({ key: "send", label: "ابعت", variant: "primary" });
    expect(i.domain).toBe("ops");
  });

  it("a handoff is a decision only when somebody must step in: a person's, or a failure that waited over 30 minutes", () => {
    expect(handoffNeedsOwner({ kind: "node_failed", assignee: "claude", waitingMin: 45 })).toBe(true);
    expect(handoffNeedsOwner({ kind: "node_failed", assignee: "claude", waitingMin: 10 })).toBe(false);
    expect(handoffNeedsOwner({ kind: "manual_run", assignee: "claude", waitingMin: 600 })).toBe(false);
    expect(handoffNeedsOwner({ kind: "needs_input", assignee: "muse", waitingMin: 600 })).toBe(false);
    expect(handoffNeedsOwner({ kind: "needs_input", assignee: "ahmad", waitingMin: 1 })).toBe(true);
    const i = fromHandoff(handoff());
    expect(i.kind).toBe("stuck");
    expect(i.actions.map((a) => a.key)).toEqual(["complete", "cancel"]);
    expect(i.actions[1]!.confirm).toBe(true);
    expect(i.why).toBe("timeout");
  });
});

describe("a standing order and the agent's advice as decisions", () => {
  it("a loosening order waits for yes / no; Claude's request to end one is «انهِه / خلّيه»", () => {
    const base = { id: "o1", text: "ارجع كبّر", domain: "ads", pending: true, endRequested: false, source: "mcp", createdAt: "2026-11-16T07:00:00.000Z" };
    expect(fromOrder(base).actions.map((a) => a.label)).toEqual(["وافق", "ارفض"]);
    const end = fromOrder({ ...base, pending: false, endRequested: true });
    expect(end.actions.map((a) => a.label)).toEqual(["انهِه", "خلّيه"]);
    expect(end.kind).toBe("order");
  });
  it("advice puts the advised answer first", () => {
    const a = { key: "j", number: 7, name: "مهمة", domain: "ads" as const, adviceText: "x", runsFrom: null, at: "2026-11-16T07:00:00.000Z" };
    expect(fromAdvice({ ...a, advice: "cancel" }).actions.map((x) => x.key)).toEqual(["cancel", "keep"]);
    expect(fromAdvice({ ...a, advice: "merge" }).actions.map((x) => x.key)).toEqual(["merge", "keep"]);
    expect(fromAdvice({ ...a, advice: "lighten" }).actions.map((x) => x.key)).toEqual(["keep", "cancel"]);
    expect(fromAdvice({ ...a, advice: "cancel" }).id).toBe("advice:j");
  });
});

describe("order and count", () => {
  const at = (n: number) => `2026-11-16T0${n}:00:00.000Z`;
  it("red first, then the one that runs out soonest, then the newest", () => {
    const items = [
      fromApproval(approval({ id: "new-yellow", urgency: "yellow", createdAt: at(9) })),
      fromApproval(approval({ id: "old-yellow", urgency: "yellow", createdAt: at(1) })),
      fromApproval(approval({ id: "soon", urgency: "orange", createdAt: at(2), expiresAt: "2026-11-16T12:00:00.000Z" })),
      fromApproval(approval({ id: "later-exp", urgency: "orange", createdAt: at(8), expiresAt: "2026-11-16T20:00:00.000Z" })),
      fromApproval(approval({ id: "no-exp", urgency: "orange", createdAt: at(7) })),
      fromApproval(approval({ id: "red", urgency: "red", createdAt: at(3) })),
    ];
    expect(sortInbox(items).map((i) => splitItemId(i.id)!.rowId)).toEqual(["red", "soon", "later-exp", "no-exp", "new-yellow", "old-yellow"]);
  });

  it("does not change the list it is given", () => {
    const items = [fromChange(change()), fromApproval(approval({ urgency: "red" }))];
    const copy = [...items];
    sortInbox(items);
    expect(items).toEqual(copy);
  });

  it("the count is the open items this person can decide on", () => {
    const items = [fromChange(change()), fromApproval(approval()), fromHandoff(handoff())];
    expect(inboxCount(items)).toBe(3);
    expect(inboxCount(items, (cap) => cap === "inbox.view")).toBe(1); // only the change has an «open» action that needs nothing more
    expect(inboxCount(items, (cap) => can("OPS_MANAGER", cap))).toBe(1);
    expect(inboxCount([])).toBe(0);
  });

  it("an id is `<source>:<row>` and an address round-trips", () => {
    expect(itemId("approval", "x1")).toBe("approval:x1");
    expect(splitItemId("handoff:h9")).toEqual({ source: "handoff", rowId: "h9" });
    expect(splitItemId("order:1")).toEqual({ source: "order", rowId: "1" });
    expect(splitItemId("creative:1")).toBeNull();
    expect(splitItemId("nonsense")).toBeNull();
    expect(decodeURIComponent(inboxHref("change:c1").split("/").pop()!)).toBe("change:c1");
  });
});
