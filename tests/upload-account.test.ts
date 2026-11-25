/**
 * WHICH ACCOUNT A VIDEO GOES TO, and which videos a launch may take (v6 · P11): never «the first account». With more than one choice the video waits and the
 * owner is told once; the account is written beside the video id; a launch takes the videos of its own account only. Meta, the database and the settings are
 * doubles — nothing is uploaded.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const s = vi.hoisted(() => ({
  accounts: [] as Row[],
  assets: [] as Row[],
  chosen: {} as Record<string, string>,
  alerts: [] as Row[],
  uploads: [] as string[],
  dir: "",
}));

vi.mock("@/server/db", () => ({
  db: {
    adAccount: {
      findMany: async () => s.accounts,
      findUnique: async ({ where }: Row) => s.accounts.find((a) => a.metaId === where.metaId) ?? null,
      count: async () => s.accounts.length,
    },
    creativeAsset: {
      findMany: async ({ where }: Row) => (where.crCode ? s.assets.filter((a) => where.crCode.in.includes(a.crCode)) : s.assets.filter((a) => a.status === "ready" && !a.metaVideoId)),
      update: async ({ where, data }: Row) => void Object.assign(s.assets.find((a) => a.id === where.id)!, data),
    },
    productEconomics: { findUnique: async ({ where }: Row) => ({ productCode: where.productCode, market: where.productCode === "JOR01" ? "JO" : "SY", moneyMissing: null, price: "20", unitCost: "2", deliveryFee: "1", returnFee: "0", codFeePct: "0", confirmCost: "0.3" }) },
    alert: {
      findFirst: async ({ where }: Row) => s.alerts.find((a) => a.kind === where.kind && a.text === where.text) ?? null,
      create: async ({ data }: Row) => void s.alerts.push(data),
    },
    page: { findUnique: async () => ({ metaId: "P", code: "SP" }) },
    freeze: { findFirst: async () => null },
    dataset: { findMany: async () => [{ metaId: "PX" }] },
    changeItem: { findMany: async () => [] },
    campaign: { findMany: async () => [] },
  },
}));
vi.mock("@/server/settings", () => ({
  getSetting: async (k: string) => (k === "creative.upload_accounts" ? s.chosen : k === "landing.pages" ? [{ productCode: "TRF01", lpCode: "LP1", url: "https://example.com/p" }] : k === "economics.default_C" ? 0.65 : k === "economics.default_D" ? 0.75 : k === "economics.profit_min_share" ? 0.3 : null),
}));
vi.mock("@/meta/write", () => ({ writeMode: () => "live", applyItem: async () => ({}) }));
vi.mock("@/core/readiness", async (orig) => ({ ...(await orig<typeof import("@/core/readiness")>()), metaWriteGate: () => ({ error: null }) }));
vi.mock("@/meta/video-upload", () => ({ uploadVideo: async (_o: unknown, _m: string, account: string) => (s.uploads.push(account), { videoId: `v${s.uploads.length}`, status: "ready", attempts: 1 }) }));
vi.mock("@/jobs/meta-sync", () => ({ metaToken: async () => "t" }));
vi.mock("@/jobs/creative-intake", () => ({ storageDir: () => s.dir }));
vi.mock("@/server/changes", () => ({ propose: async () => ({}) }));
vi.mock("@/server/auth", () => ({ HttpError: class extends Error {} }));
vi.mock("@/agents/guard", () => ({ guardText: async () => ({ verdict: "pass", issues: [] }) }));

import { accountChoices, uploadAccount, videoProblem, type LaunchAccount } from "@/core/launch-guard";
import { uploadReadyCreatives } from "@/jobs/creative-upload";
import { prepareLaunch } from "@/server/launch";

const a = (metaId: string, market: string | null, currency = "USD"): LaunchAccount & Row => ({ metaId, name: metaId, market, currency });
const asset = (crCode: string, productCode: string | null, over: Row = {}): Row => ({ id: crCode, crCode, productCode, status: "ready", metaVideoId: null, metaAccountId: null, fileName: `${crCode}.mp4`, notes: null, policyFlag: "green", thumbnailHash: null, hookType: null, angle: null, conceptId: null, ...over });
const file = (crCode: string) => {
  mkdirSync(path.join(s.dir, crCode), { recursive: true });
  writeFileSync(path.join(s.dir, crCode, `${crCode}.mp4`), "x");
};

beforeEach(() => {
  Object.assign(s, { accounts: [], assets: [], chosen: {}, alerts: [], uploads: [], dir: mkdtempSync(path.join(os.tmpdir(), "mb-upload-")) });
});

describe("the account a ready video goes to", () => {
  it("the single account of its market", () => expect(uploadAccount([a("jo", "JO"), a("sy", "SY")], "SY", {})).toEqual({ metaId: "sy" }));
  it("two of the market: it waits, and says where to choose", () => {
    const r = uploadAccount([a("sy1", "SY"), a("sy2", "SY")], "SY", {});
    expect(r).toHaveProperty("why");
    expect((r as { why: string }).why).toContain("سوريا");
  });
  it("his choice wins; a choice that is another market's account now is ignored", () => {
    const accounts = [a("sy1", "SY"), a("sy2", "SY"), a("jo", "JO")];
    expect(uploadAccount(accounts, "SY", { SY: "sy2" })).toEqual({ metaId: "sy2" });
    expect(uploadAccount(accounts, "SY", { SY: "jo" })).toHaveProperty("why");
  });
  it("the dollar account of the market before one of another currency; a market with only a foreign account keeps its videos in it", () => {
    expect(uploadAccount([a("jod", "JO", "JOD"), a("usd", "JO")], "JO", {})).toEqual({ metaId: "usd" });
    expect(uploadAccount([a("jod", "JO", "JOD"), a("sy", "SY")], "JO", {})).toEqual({ metaId: "jod" });
  });
  it("no market set on any account: the only one, else it waits", () => {
    expect(uploadAccount([a("x", null)], "SY", {})).toEqual({ metaId: "x" });
    expect(uploadAccount([a("x", null), a("y", null)], "SY", {})).toHaveProperty("why");
  });
  it("a market nobody has an account for, and a video with no product among several accounts, wait", () => {
    expect(uploadAccount([a("jo", "JO")], "SY", {})).toHaveProperty("why");
    expect(uploadAccount([a("jo", "JO"), a("sy", "SY")], null, {})).toHaveProperty("why");
    expect(uploadAccount([a("sy", "SY")], null, {})).toEqual({ metaId: "sy" });
    expect(uploadAccount([], "SY", {})).toHaveProperty("why");
  });
});

describe("the upload job", () => {
  it("waits with two accounts of a market, says it once, and does not hold the other market's videos back", async () => {
    s.accounts = [a("sy1", "SY"), a("sy2", "SY"), a("jo", "JO")];
    s.assets = [asset("CR00001", "TRF01"), asset("CR00002", "JOR01")];
    file("CR00001");
    file("CR00002");
    const first = await uploadReadyCreatives(1);
    expect(s.uploads).toEqual(["jo"]);
    expect(first).toMatchObject({ uploaded: 1, unplaced: 1 });
    expect(s.assets[1]).toMatchObject({ metaVideoId: "v1", metaAccountId: "jo", status: "uploaded" });
    expect(s.assets[0]!.metaVideoId).toBeNull();
    await uploadReadyCreatives(1);
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0]!.kind).toBe("creative.upload_account");
    // he chooses: the video goes there and the account is written beside it
    s.chosen = { SY: "sy2" };
    await uploadReadyCreatives();
    expect(s.assets[0]).toMatchObject({ metaAccountId: "sy2", status: "uploaded" });
  });
});

describe("a launch takes the videos of its own account", () => {
  it("another account's video is refused; an unrecorded one only when there is a single account", () => {
    expect(videoProblem("sy1", "sy1", 3)).toBeNull();
    expect(videoProblem("sy2", "sy1", 3)).toContain("تاني");
    expect(videoProblem(null, "sy1", 1)).toBeNull();
    expect(videoProblem(null, "sy1", 2)).toContain("ما منعرف");
  });
  it("the wizard offers the accounts that hold every chosen video", () => {
    const accounts = [a("sy1", "SY"), a("sy2", "SY")];
    expect(accountChoices(accounts, "SY", [])).toMatchObject({ preselected: null });
    expect(accountChoices(accounts, "SY", ["sy2", "sy2"])).toMatchObject({ preselected: "sy2", options: [{ metaId: "sy2" }] });
    const mixed = accountChoices(accounts, "SY", ["sy1", "sy2"]);
    expect(mixed).toMatchObject({ preselected: null, options: [] });
    expect(mixed.none).toContain("نفس الحساب");
  });
  it("the server refuses it too", async () => {
    s.accounts = [a("act_sy1", "SY"), a("act_sy2", "SY")];
    s.assets = [asset("CR00001", "TRF01", { metaVideoId: "v1", metaAccountId: "act_sy2", status: "uploaded" })];
    const input = { template: "CRT" as const, productCode: "TRF01", market: "SY" as const, accountMetaId: "act_sy1", pageMetaId: "P", datasetMetaId: "PX", landingUrl: "https://example.com/p", lpCode: "LP1", crCodes: ["CR00001"], message: "اطلبه وادفع عند الاستلام", title: "اطلب هلأ" };
    const refused = await prepareLaunch(input);
    expect(refused.ok).toBe(false);
    expect((refused as { problems: string[] }).problems).toEqual(["CR00001: مرفوع على حساب إعلاني تاني"]);
    expect((await prepareLaunch({ ...input, accountMetaId: "act_sy2" })).ok).toBe(true);
  });
});
