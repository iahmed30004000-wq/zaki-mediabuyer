/**
 * THE CONTRACT WITH CLAUDE (v6 P0-4): what `tools/list` tells the agent, and what the in-site assistant is told, must not move
 * by one byte when a library is upgraded. The three files in tests/fixtures were written BEFORE the library upgrades and are
 * compared as text, so a different key order or a missing `required` fails here.
 * A change on purpose: UPDATE_MCP_SNAPSHOT=1 npx vitest run tests/mcp-schemas.snapshot.test.ts — and say why in docs/DECISIONS.md.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { handleRpc, toolList } from "@/core/mcp-rpc";
import { toolSpecs } from "@/core/assistant";
import { toJsonSchema } from "@/core/zod-schema";
import { TOOLS } from "@/server/mcp/tools";
import { makeTools } from "@/server/assistant/tools";

const DIR = path.resolve(__dirname, "fixtures");
const text = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const check = (file: string, actual: string) => {
  const p = path.join(DIR, file);
  if (process.env.UPDATE_MCP_SNAPSHOT === "1") fs.writeFileSync(p, actual);
  expect(actual).toBe(fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n"));
};

const INFO = { name: "zaki-mediabuyer", version: "snapshot", instructions: "x" };

describe("MCP tool contract does not move (v6 P0-4)", () => {
  it("there are 23 tools (22 + ack_approval, v6 P1-1)", () => {
    expect(TOOLS).toHaveLength(23);
  });

  it("the input schema of each of the 23 tools (what the validators produce) is byte-identical", () => {
    const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, toJsonSchema(t.listSchema ?? t.input)]));
    check("mcp-input-schemas.json", text(schemas));
  });

  it("the `tools/list` answer (name, title, description, schema, annotations) is byte-identical", async () => {
    const reply = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, TOOLS, { tokenId: "t", tokenName: "t", actor: { type: "agent", id: "mcp:t" } }, INFO);
    expect(reply.status).toBe(200);
    expect(JSON.stringify(reply.body)).toBe(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: toolList(TOOLS) } }));
    check("mcp-tools-list.json", text(reply.body));
  });

  it("the tool list of the in-site assistant (same converter) is byte-identical", () => {
    check("assistant-tool-specs.json", text(toolSpecs(makeTools())));
  });
});
