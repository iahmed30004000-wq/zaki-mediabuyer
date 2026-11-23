import { describe, expect, it } from "vitest";
import { datasetProblem, landingProblem, normalizeUrl, type LandingPage } from "@/core/launch-guard";

/** A launch may only point at a landing link and a dataset the owner registered. */
const pages: LandingPage[] = [
  { productCode: "TRF01", lpCode: "LP1", url: "https://shop.example.test/trf01" },
  { productCode: "TRF01", lpCode: "LP2", url: "https://shop.example.test/trf01-b/?src=fb" },
];
const ask = (landingUrl: string, productCode = "TRF01", lpCode = "LP1") => ({ productCode, lpCode, landingUrl });

describe("the landing link", () => {
  it("the registered link passes — the trailing slash, the fragment and the host's case do not matter", () => {
    expect(landingProblem(ask("https://shop.example.test/trf01"), pages)).toBeNull();
    expect(landingProblem(ask("https://SHOP.example.test/trf01/#top"), pages)).toBeNull();
    expect(landingProblem(ask("https://shop.example.test/trf01-b?src=fb", "TRF01", "LP2"), pages)).toBeNull();
  });
  it("any other https link is refused, even on a look-alike or the same host", () => {
    expect(landingProblem(ask("https://evil.example.test/trf01"), pages)).toContain("مش هو المسجّل");
    expect(landingProblem(ask("https://shop.example.test/other"), pages)).toContain("مش هو المسجّل");
    expect(landingProblem(ask("https://shop.example.test.evil.test/trf01"), pages)).not.toBeNull();
  });
  it("a different query string is a different link", () => expect(landingProblem(ask("https://shop.example.test/trf01?x=1"), pages)).not.toBeNull());
  it("a page that is not registered for this product / code is refused and the sentence says to register it", () => {
    expect(landingProblem(ask("https://shop.example.test/trf01", "TRF01", "LP3"), pages)).toContain("مش مسجّلة");
    expect(landingProblem(ask("https://shop.example.test/trf01", "TIN01", "LP1"), pages)).toContain("مش مسجّلة");
    expect(landingProblem(ask("https://shop.example.test/trf01"), [])).toContain("مش مسجّلة");
  });
  it("http, junk and javascript: are not links", () => {
    expect(landingProblem(ask("http://shop.example.test/trf01"), pages)).toContain("https");
    expect(landingProblem(ask("not a link"), pages)).toContain("https");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("the dataset", () => {
  it("a known one passes, a typed one does not", () => {
    expect(datasetProblem("PX1", ["PX1", "PX2"])).toBeNull();
    expect(datasetProblem("PX9", ["PX1", "PX2"])).toContain("مش من اللي");
  });
  it("with no dataset registered nothing is accepted, and the sentence says so", () => expect(datasetProblem("PX1", [])).toContain("ما في Dataset"));
});
