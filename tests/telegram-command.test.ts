import { describe, expect, it } from "vitest";
import { creativeCodeOf, parseTelegram } from "@/core/telegram-command";

describe("Telegram commands (spec 9.6)", () => {
  it("«اوقف» in its spellings", () => {
    expect(parseTelegram("اوقف CR00147")).toEqual({ kind: "pause", query: "CR00147" });
    expect(parseTelegram("وقّف  ماء الكمأة")).toEqual({ kind: "pause", query: "ماء الكمأة" });
    expect(parseTelegram("/stop cr147")).toEqual({ kind: "pause", query: "cr147" });
    expect(parseTelegram("اوقف CR٠٠١٤٧")).toEqual({ kind: "pause", query: "CR00147" });
  });

  it("anything that spends is refused — never approved from Telegram", () => {
    expect(parseTelegram("وافق")).toEqual({ kind: "site_only", what: "الموافقة" });
    expect(parseTelegram("زيد الميزانية 20%")).toEqual({ kind: "site_only", what: "زيادة الصرف" });
    expect(parseTelegram("شغّل CR00147")).toEqual({ kind: "site_only", what: "التشغيل" });
    expect(parseTelegram("approve cs-101")).toEqual({ kind: "site_only", what: "الموافقة" });
  });

  it("help and noise", () => {
    expect(parseTelegram("/start")).toEqual({ kind: "help" });
    expect(parseTelegram("مرحبا")).toEqual({ kind: "unknown" });
  });

  it("creative codes in short forms", () => {
    expect(creativeCodeOf("CR00147")).toBe("CR00147");
    expect(creativeCodeOf("cr147")).toBe("CR00147");
    expect(creativeCodeOf("147")).toBe("CR00147");
    expect(creativeCodeOf("ماء الكمأة")).toBeNull();
  });
});
