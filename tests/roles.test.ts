import { describe, expect, it } from "vitest";
import { CAPABILITIES, ROLES, ROLE_PLACES, ROLE_START, can, canOpenPath, capabilitiesOf, hasHome, inboxDomainsOf, taskScopeOf, type Capability, type RoleKey } from "@/core/roles";
import { redact } from "@/server/audit";

/** docs/rebuild/05-permissions.md §3, cell by cell: eight roles × eighteen capabilities. 1 = the role has it. */
const COLS: RoleKey[] = ["OWNER", "MANAGER", "ADS_MANAGER", "OPS_MANAGER", "TEAM_LEAD", "MEMBER", "ANALYST", "VIEWER"];
const EXPECTED: Record<Capability, number[]> = {
  //                          OWN MGR ADS OPS LEAD MEM ANA VIEW
  "ads.view": [1, 1, 1, 0, 0, 0, 1, 1],
  "ads.propose": [1, 1, 1, 0, 0, 0, 1, 0],
  "ads.pause": [1, 1, 1, 0, 0, 0, 0, 0],
  "ads.approve_within_cap": [1, 1, 1, 0, 0, 0, 0, 0],
  "ads.connect": [1, 0, 1, 0, 0, 0, 0, 0],
  "ops.view": [1, 1, 0, 1, 1, 0, 1, 1],
  "ops.people": [1, 1, 0, 1, 1, 0, 0, 0],
  "ops.send": [1, 1, 0, 1, 0, 0, 0, 0],
  "money.view": [1, 1, 1, 0, 0, 0, 1, 0],
  "work.view": [1, 1, 1, 1, 1, 0, 1, 1],
  "work.control": [1, 1, 0, 0, 0, 0, 0, 0],
  "orders.restrict": [1, 1, 0, 0, 0, 0, 0, 0],
  "tasks.manage": [1, 1, 1, 1, 1, 0, 0, 0],
  "tasks.own": [1, 1, 1, 1, 1, 1, 1, 0],
  "inbox.view": [1, 1, 1, 1, 0, 0, 0, 0],
  "assistant.use": [1, 1, 1, 1, 0, 0, 1, 0],
  "settings.view": [1, 1, 0, 0, 0, 0, 0, 0],
  owner_only: [1, 0, 0, 0, 0, 0, 0, 0],
};

describe("roles (docs/rebuild/05-permissions.md §3): 8 roles × 18 capabilities", () => {
  it("the table has exactly eight roles and eighteen capabilities, in the documented order", () => {
    expect(ROLES).toEqual(COLS);
    expect(CAPABILITIES).toHaveLength(18);
    expect(Object.keys(EXPECTED).sort()).toEqual([...CAPABILITIES].sort());
  });
  for (const [cap, row] of Object.entries(EXPECTED) as [Capability, number[]][]) {
    it(cap, () => {
      expect(COLS.map((r) => (can(r, cap) ? 1 : 0))).toEqual(row);
    });
  }
  it("the old capability names are gone: nothing answers to «view» or «propose_change» any more", () => {
    for (const old of ["view", "connect_meta", "propose_change", "pause_or_reduce", "approve_within_cap", "kill_switch"]) expect((CAPABILITIES as readonly string[]).includes(old)).toBe(false);
  });
  it("only the owner holds «owner_only»; a viewer can never execute anything", () => {
    expect(COLS.filter((r) => can(r, "owner_only"))).toEqual(["OWNER"]);
    for (const cap of ["ads.pause", "ads.approve_within_cap", "ads.propose", "work.control", "orders.restrict", "owner_only", "tasks.manage"] as const) expect(can("VIEWER", cap)).toBe(false);
  });
  it("a manager has everything except what is for the owner only (and connecting a Facebook account)", () => {
    expect(CAPABILITIES.filter((c) => !can("MANAGER", c)).sort()).toEqual(["ads.connect", "owner_only"]);
  });
  it("a member holds one thing: their own tasks", () => {
    expect(capabilitiesOf("MEMBER")).toEqual(["tasks.own"]);
  });
  it("money is for ads, analyst, manager, owner — an ops manager, a team lead, a member and a viewer never see a profit", () => {
    expect(COLS.filter((r) => can(r, "money.view"))).toEqual(["OWNER", "MANAGER", "ADS_MANAGER", "ANALYST"]);
  });
});

describe("where each role lands and what it sees (§3)", () => {
  it("the bar by role", () => {
    expect(ROLE_PLACES.OWNER).toEqual(["home", "inbox", "work", "ads", "ops"]);
    expect(ROLE_PLACES.MANAGER).toEqual(ROLE_PLACES.OWNER);
    expect(ROLE_PLACES.ADS_MANAGER).toEqual(["home", "inbox", "work", "ads"]);
    expect(ROLE_PLACES.OPS_MANAGER).toEqual(["home", "inbox", "work", "ops"]);
    expect(ROLE_PLACES.TEAM_LEAD).toEqual(["work", "ops"]);
    expect(ROLE_PLACES.MEMBER).toEqual(["work"]);
    expect(ROLE_PLACES.ANALYST).toEqual(["home", "work", "ads"]);
    expect(ROLE_PLACES.VIEWER).toEqual(["home", "ads", "ops"]);
  });
  it("the start page by role; the ones without a home are sent to theirs", () => {
    expect(ROLE_START.TEAM_LEAD).toBe("/ops/confirm");
    expect(ROLE_START.MEMBER).toBe("/work/tasks");
    expect(COLS.filter((r) => !hasHome(r))).toEqual(["TEAM_LEAD", "MEMBER"]);
    for (const r of COLS) expect(canOpenPath(r, ROLE_START[r]), r).toBe(true);
  });
  it("every place in a role's bar is a place it may open, and the ones not in it answer «not yours»", () => {
    const addr: Record<string, string> = { inbox: "/inbox", work: "/work", ads: "/ads", ops: "/ops" };
    for (const r of COLS) {
      for (const [place, path] of Object.entries(addr)) {
        const inBar = (ROLE_PLACES[r] as readonly string[]).includes(place);
        if (r === "MEMBER" && place === "work") continue;
        expect(canOpenPath(r, path), `${r} ${path}`).toBe(inBar);
      }
    }
  });
  it("a member opens only the tasks page of «الشغل»; the settings are for the owner and the manager", () => {
    expect(canOpenPath("MEMBER", "/work/tasks")).toBe(true);
    expect(canOpenPath("MEMBER", "/work")).toBe(false);
    expect(canOpenPath("MEMBER", "/work/reports")).toBe(false);
    expect(COLS.filter((r) => canOpenPath(r, "/settings/team"))).toEqual(["OWNER", "MANAGER"]);
    expect(canOpenPath("VIEWER", "/login")).toBe(true);
  });
  it("whose tasks and which decisions: the scope of a role", () => {
    expect(COLS.map(taskScopeOf)).toEqual(["all", "all", "all", "all", "team", "own", "own", "own"]);
    expect(inboxDomainsOf("OWNER")).toEqual(["ads", "ops", "work"]);
    expect(inboxDomainsOf("ADS_MANAGER")).toEqual(["ads", "work"]);
    expect(inboxDomainsOf("OPS_MANAGER")).toEqual(["ops", "work"]);
    expect(inboxDomainsOf("TEAM_LEAD")).toEqual([]);
    expect(inboxDomainsOf("VIEWER")).toEqual([]);
  });
});

describe("the audit log never stores a secret", () => {
  it("redacts tokens, hashes and customer references at any depth", () => {
    expect(redact({ name: "x", accessToken: "EAAB…", nested: [{ capiRef: "enc:9f", phone: "+963" }], passwordHash: "$2a" })).toEqual({
      name: "x",
      accessToken: "[redacted]",
      nested: [{ capiRef: "[redacted]", phone: "[redacted]" }],
      passwordHash: "[redacted]",
    });
  });
});

describe("the team (spec 13.8)", () => {
  it("an invite code is 4×4 readable characters; only its hash is compared, in any case", async () => {
    const { newInviteCode, hashInvite } = await import("@/server/team");
    const c = newInviteCode();
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    expect(hashInvite(c.toLowerCase())).toBe(hashInvite(c));
    expect(newInviteCode()).not.toBe(c);
  });
  it("the last owner can never be demoted or switched off; nobody changes their own role", async () => {
    const { teamChange } = await import("@/server/team");
    expect(teamChange({ actorId: "a", targetId: "b", targetRole: "OWNER", owners: 1, to: { role: "ANALYST" } }).ok).toBe(false);
    expect(teamChange({ actorId: "a", targetId: "b", targetRole: "OWNER", owners: 2, to: { active: false } }).ok).toBe(true);
    expect(teamChange({ actorId: "a", targetId: "a", targetRole: "OWNER", owners: 2, to: { role: "VIEWER" } }).ok).toBe(false);
    expect(teamChange({ actorId: "a", targetId: "b", targetRole: "ANALYST", owners: 1, to: { role: "ADS_MANAGER" } }).ok).toBe(true);
  });
});
