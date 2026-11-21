/**
 * A layout does not run again on a client-side navigation, so every page asks for itself.
 * Part 1 walks every page.tsx; part 2 runs requirePage() for the cases that matter (no session, an inactive user, a role that may not open the page).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..", "src", "app");
const pages = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pages(path.join(dir, e.name)) : e.name === "page.tsx" ? [path.join(dir, e.name)] : []));

/** The door itself, the offline page, and the OAuth consent screen (it reads the session on its own and says so to a signed-out visitor). */
const PUBLIC = new Set(["login/page.tsx", "offline/page.tsx", "oauth/authorize/page.tsx"]);

describe("every page asks for itself", () => {
  const all = pages(root).map((f) => path.relative(root, f).split(path.sep).join("/"));
  it("there are pages to check", () => expect(all.length).toBeGreaterThan(30));
  for (const rel of all.filter((r) => !PUBLIC.has(r))) {
    it(`${rel} calls requirePage() first`, () => {
      const src = readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
      expect(src, rel).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\n\s*await requirePage\(/s);
    });
  }
});

let user: { id: string; active: boolean; sessionVer: number; role: string } | null = null;
let session: { sub: string; ver: number } | null = null;
let pathname: string | null = null;

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => ({ value: "tok" }) }),
  headers: () => ({ get: (k: string) => (k === "x-pathname" ? pathname : null) }),
}));
vi.mock("@/lib/session-token", () => ({ SESSION_COOKIE: "mb_session", SESSION_DAYS: 14, authRequired: () => true, readSession: async () => session, signSession: async () => "t" }));
vi.mock("@/server/db", () => ({ db: { user: { findUnique: async () => user } } }));

import { requirePage } from "@/server/auth";

const signIn = (role: string, over: Partial<NonNullable<typeof user>> = {}) => {
  user = { id: "u1", active: true, sessionVer: 3, role, ...over };
  session = { sub: "u1", ver: 3 };
};

beforeEach(() => {
  user = null;
  session = null;
  pathname = null;
});

describe("requirePage", () => {
  it("nobody signed in → the door", async () => {
    await expect(requirePage("ads.view")).rejects.toThrow("REDIRECT:/login");
    await expect(requirePage()).rejects.toThrow("REDIRECT:/login");
  });

  it("an inactive user → the door", async () => {
    signIn("MANAGER", { active: false });
    await expect(requirePage("ads.view")).rejects.toThrow("REDIRECT:/login");
  });

  it("a session whose version moved → the door", async () => {
    signIn("MANAGER");
    session = { sub: "u1", ver: 2 };
    await expect(requirePage("ads.view")).rejects.toThrow("REDIRECT:/login");
  });

  it("a member on a settings page → the page they start on, not the settings", async () => {
    signIn("MEMBER");
    await expect(requirePage("settings.view")).rejects.toThrow("REDIRECT:/work/tasks");
  });

  it("the capability decides even when the path header is missing", async () => {
    signIn("VIEWER");
    await expect(requirePage("owner_only")).rejects.toThrow("REDIRECT:/");
  });

  it("the table of places decides too (an analyst holds ops.view but has no operations place)", async () => {
    signIn("ANALYST");
    pathname = "/ops/stock";
    await expect(requirePage("ops.view")).rejects.toThrow("REDIRECT:/");
  });

  it("a role without a home is sent to where it starts", async () => {
    signIn("MEMBER");
    pathname = "/";
    await expect(requirePage()).rejects.toThrow("REDIRECT:/work/tasks");
  });

  it("the right role gets the caller back", async () => {
    signIn("OWNER");
    pathname = "/settings/connections";
    await expect(requirePage("owner_only")).resolves.toMatchObject({ id: "u1", role: "OWNER" });
    signIn("MEMBER");
    pathname = "/work/tasks";
    await expect(requirePage(["tasks.own", "tasks.manage"])).resolves.toMatchObject({ role: "MEMBER" });
  });

  it("a member may not open the print pages of the numbers", async () => {
    signIn("MEMBER");
    pathname = "/print/numbers";
    await expect(requirePage("money.view")).rejects.toThrow("REDIRECT:/work/tasks");
  });
});
