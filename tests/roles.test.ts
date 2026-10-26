import { describe, expect, it } from "vitest";
import { can, ROLES, type Capability } from "@/core/roles";
import { redact } from "@/server/audit";

/** Spec 13.8, cell by cell. */
const EXPECTED: Record<Capability, [boolean, boolean, boolean, boolean]> = {
  //                  OWNER  MANAGER ANALYST VIEWER
  view: [true, true, true, true],
  connect_meta: [true, true, false, false],
  propose_change: [true, true, true, false],
  pause_or_reduce: [true, true, false, false],
  approve_within_cap: [true, true, false, false],
  owner_only: [true, false, false, false],
  kill_switch: [true, true, false, false],
};

describe("roles (spec 13.8)", () => {
  for (const [cap, row] of Object.entries(EXPECTED) as [Capability, boolean[]][]) {
    it(cap, () => {
      expect(ROLES.map((r) => can(r, cap))).toEqual(row);
    });
  }
  it("a viewer can never execute anything", () => {
    for (const cap of ["pause_or_reduce", "approve_within_cap", "owner_only", "kill_switch", "propose_change"] as const) expect(can("VIEWER", cap)).toBe(false);
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
