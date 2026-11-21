/**
 * A client nobody approved is dropped after a day, and only approved clients count toward the cap of 50.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Client = { id: string; clientId: string; name: string; redirectUris: string[]; createdAt: Date; revokedAt: Date | null };
const s = vi.hoisted(() => ({ clients: [] as Client[], granted: new Set<string>(), n: 0 }));

vi.mock("@/server/db", () => ({
  db: {
    oAuthGrant: { findMany: async () => [...s.granted].map((clientId) => ({ clientId })) },
    oAuthClient: {
      deleteMany: async ({ where }: { where: { createdAt: { lt: Date }; id: { notIn: string[] } } }) => {
        const before = s.clients.length;
        s.clients = s.clients.filter((c) => !(c.createdAt < where.createdAt.lt && !where.id.notIn.includes(c.id)));
        return { count: before - s.clients.length };
      },
      findMany: async ({ where }: { where: { revokedAt: null; name: string } }) => s.clients.filter((c) => c.revokedAt === null && c.name === where.name),
      count: async ({ where }: { where: { revokedAt: null; id: { in: string[] } } }) => s.clients.filter((c) => c.revokedAt === null && where.id.in.includes(c.id)).length,
      create: async ({ data }: { data: { clientId: string; name: string; redirectUris: string[] } }) => {
        const c: Client = { id: `c${++s.n}`, ...data, createdAt: new Date(), revokedAt: null };
        s.clients.push(c);
        return c;
      },
    },
  },
}));
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import { UNAPPROVED_TTL_MS, registerClient } from "@/server/oauth";

const reg = (n: number) => registerClient({ client_name: `App ${n}`, redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" });
const seed = (n: number, ageMs: number, granted: boolean) => {
  const c: Client = { id: `s${n}`, clientId: `mbc_${n}`, name: `Seed ${n}`, redirectUris: ["https://claude.ai/api/mcp/auth_callback"], createdAt: new Date(Date.now() - ageMs), revokedAt: null };
  s.clients.push(c);
  if (granted) s.granted.add(c.id);
};

beforeEach(() => {
  s.clients = [];
  s.granted = new Set();
  s.n = 0;
});

describe("registerClient and the cap", () => {
  it("clients nobody approved do not count toward the cap", async () => {
    for (let i = 0; i < 50; i++) seed(i, 60_000, false);
    expect((await reg(999)).ok).toBe(true);
  });

  it("fifty APPROVED clients still do", async () => {
    for (let i = 0; i < 50; i++) seed(i, 60_000, true);
    const r = await reg(999);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ status: 429 });
  });

  it("an unapproved client older than a day is forgotten; an approved old one and a fresh unapproved one stay", async () => {
    seed(1, UNAPPROVED_TTL_MS + 60_000, false);
    seed(2, UNAPPROVED_TTL_MS + 60_000, true);
    seed(3, 60_000, false);
    await reg(999);
    expect(s.clients.map((c) => c.id).sort()).toEqual(["c1", "s2", "s3"]);
  });

  it("the same app registering again still gets its own client back", async () => {
    const a = await reg(1);
    const b = await reg(1);
    expect(a.ok && b.ok && a.data.client_id === b.data.client_id).toBe(true);
    expect(s.clients).toHaveLength(1);
  });
});
