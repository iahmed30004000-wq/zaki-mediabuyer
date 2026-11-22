/**
 * A phone number written with no plus, with spaces or with dashes is still a phone and must not reach a model.
 */
import { describe, expect, it } from "vitest";
import { privacyHits } from "@/gateway/privacy";

describe("phone shapes the filter missed", () => {
  for (const t of ["اتصل على 963944123456", "رقمه 962791234567", "0944 123 456", "0944-123-456", "0944.123.456", "+963 944 123 456", "00963-944-123-456", "٠٩٤٤ ١٢٣ ٤٥٦", "079 123 4567", "78 123 4567"]) {
    it(`refuses «${t}»`, () => expect(privacyHits(t)).toContain("phone"));
  }
});

describe("what is not a phone", () => {
  for (const t of ["الصرف اليوم 1,250.00$ و 38 طلب", "2026-11-21 09:30", "CR00147_H07_HER_LP1 · 12 ظهور · 3 شراء", "ROAS 2.21 وتكلفة 5.51", "الأسبوع 47 من 2026", "12 345 دولار"]) {
    it(`leaves «${t}» alone`, () => expect(privacyHits(t)).not.toContain("phone"));
  }
});
