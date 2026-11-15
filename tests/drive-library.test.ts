import { describe, expect, it } from "vitest";
import { DRIVE_FOLDERS, driveIdOf, linkFiles, parseCsv, planRegister, readRegister, sameName, type LibraryFile, type LibraryVideo } from "@/core/drive-library";

describe("the register as a CSV", () => {
  it("reads quotes with commas and line breaks inside, doubled quotes and CRLF", () => {
    const rows = parseCsv('job,name,notes\r\n345,V215,"two, hooks\nand a ""test"""\r\n\r\n346,V216,\r\n');
    expect(rows).toEqual([
      ["job", "name", "notes"],
      ["345", "V215", 'two, hooks\nand a "test"'],
      ["346", "V216", ""],
    ]);
  });

  it("drops a BOM and finds the separator: ; or a tab", () => {
    expect(parseCsv("﻿job;v\n1;V1")).toEqual([["job", "v"], ["1", "V1"]]);
    expect(parseCsv("job\tv\n1\tV1")).toEqual([["job", "v"], ["1", "V1"]]);
  });

  it("a separator inside quotes does not count when the separator is chosen", () => {
    expect(parseCsv('"a;b;c",d\n1,2')).toEqual([["a;b;c", "d"], ["1", "2"]]);
  });
});

describe("a Drive file id from what the owner pastes", () => {
  it("takes it from a link, from ?id= and from the id itself — nothing else", () => {
    expect(driveIdOf("https://drive.google.com/file/d/1AbC_def-GHI234/view?usp=sharing")).toBe("1AbC_def-GHI234");
    expect(driveIdOf("https://drive.google.com/open?id=1AbC_def-GHI234")).toBe("1AbC_def-GHI234");
    expect(driveIdOf("1AbC_def-GHI234")).toBe("1AbC_def-GHI234");
    expect(driveIdOf("")).toBeNull();
    expect(driveIdOf("not an id with spaces")).toBeNull();
    expect(driveIdOf(null)).toBeNull();
  });
});

describe("readRegister", () => {
  it("maps English and Arabic headers, and reads a status in his words", () => {
    const r = readRegister(parseCsv("JOB,اسم الفيديو,المنتج,الحالة,رابط الفيديو,رابط السيناريو,ملاحظات\n345,V215,TRF01,جاهز,https://drive.google.com/file/d/1AbC_def-GHI234/view,1ScEnArIo_file9,نسخة أولى\n"));
    expect(r.problems).toEqual([]);
    expect(r.mapped).toMatchObject({ job: "JOB", vName: "اسم الفيديو", product: "المنتج", status: "الحالة", drive: "رابط الفيديو", scenario: "رابط السيناريو" });
    expect(r.rows[0]).toEqual({ job: "345", vName: "V215", product: "TRF01", status: "ready", driveFileId: "1AbC_def-GHI234", scenarioFileId: "1ScEnArIo_file9", notes: "نسخة أولى" });
  });

  it("finds the header below a title line", () => {
    const r = readRegister([["سجل الفيديوهات", "", ""], ["job", "v name", "product"], ["7", "V7", "TIN01"]]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.vName).toBe("V7");
  });

  it("without a JOB column and a video-name column nothing is read, and it says so", () => {
    const r = readRegister([["name", "price"], ["x", "1"]]);
    expect(r.rows).toEqual([]);
    expect(r.problems[0]).toContain("JOB");
  });

  it("skips a row with half its key and a repeated one, each said with its line number", () => {
    const r = readRegister(parseCsv("job,v\n1,V1\n,V2\n3,\n1,V1\n4,V4\n"));
    expect(r.rows.map((x) => x.vName)).toEqual(["V1", "V4"]);
    expect(r.problems).toHaveLength(3);
    expect(r.problems[0]).toContain("سطر 3");
  });

  it("a status it does not know is left empty, never guessed", () => {
    expect(readRegister(parseCsv("job,v,status\n1,V1,شي غريب\n")).rows[0]!.status).toBeNull();
  });
});

describe("which file is which video's", () => {
  const video = (job: string, vName: string, product = "TRF01", over: Partial<LibraryVideo> = {}): LibraryVideo => ({ key: `${job}|${vName}`, job, vName, product, driveFileId: null, scenarioFileId: null, ...over });
  const file = (id: string, name: string, product: string | null = null): LibraryFile => ({ id, name, product });

  it("the V name in the file's name ties it — whatever the extension or the version tail", () => {
    const p = linkFiles([video("345", "V215")], [file("F1", "V215_v2.mp4")], "driveFileId");
    expect(p.links).toEqual([{ key: "345|V215", field: "driveFileId", fileId: "F1", fileName: "V215_v2.mp4" }]);
  });

  it("V21 never takes the file of V215", () => {
    const p = linkFiles([video("1", "V21"), video("2", "V215")], [file("F1", "V215.mp4")], "driveFileId");
    expect(p.links.map((l) => l.key)).toEqual(["2|V215"]);
  });

  it("with no V name in the file, the JOB number ties it — but never a number of 1–2 characters", () => {
    expect(linkFiles([video("345", "V215")], [file("F1", "سيناريو JOB 345.docx")], "scenarioFileId").links).toHaveLength(1);
    expect(linkFiles([video("7", "V215")], [file("F1", "سيناريو 7.docx")], "scenarioFileId").links).toHaveLength(0);
  });

  it("a file in a product's folder only fits that product's videos", () => {
    const p = linkFiles([video("1", "V9", "TRF01"), video("2", "V9", "TIN01")], [file("F1", "V9.mp4", "TIN01")], "driveFileId");
    expect(p.links.map((l) => l.key)).toEqual(["2|V9"]);
  });

  it("a file two videos fit equally is ambiguous: nobody gets it", () => {
    const p = linkFiles([video("1", "V9", "TRF01"), video("2", "V9", "TIN01")], [file("F1", "V9.mp4")], "driveFileId");
    expect(p.links).toEqual([]);
    expect(p.ambiguous[0]!.reason).toContain("أكتر من فيديو");
  });

  it("two files for one video: the owner picks, nothing is set", () => {
    const p = linkFiles([video("345", "V215")], [file("F1", "V215.mp4"), file("F2", "V215 final.mp4")], "driveFileId");
    expect(p.links).toEqual([]);
    expect(p.ambiguous[0]!.reason).toContain("أكتر من ملف");
  });

  it("a link is set only where it is empty: another file is a conflict, the same one is already done", () => {
    const has = video("345", "V215", "TRF01", { driveFileId: "OTHER" });
    expect(linkFiles([has], [file("F1", "V215.mp4")], "driveFileId")).toMatchObject({ links: [], conflicts: [{ key: "345|V215", has: "OTHER", found: "F1" }] });
    expect(linkFiles([video("345", "V215", "TRF01", { driveFileId: "F1" })], [file("F1", "V215.mp4")], "driveFileId")).toMatchObject({ links: [], conflicts: [], already: 1 });
  });

  it("a file that fits no video is listed", () => {
    const p = linkFiles([video("345", "V215")], [file("F1", "random clip.mp4")], "driveFileId");
    expect(p.unmatched.map((f) => f.name)).toEqual(["random clip.mp4"]);
  });

  it("the scenario field is its own: a video with a file may still get a scenario", () => {
    const has = video("345", "V215", "TRF01", { driveFileId: "F1" });
    expect(linkFiles([has], [file("S1", "V215 سيناريو.docx")], "scenarioFileId").links).toEqual([{ key: "345|V215", field: "scenarioFileId", fileId: "S1", fileName: "V215 سيناريو.docx" }]);
  });
});

describe("the register against the bank", () => {
  const row = (job: string, vName: string, over = {}) => ({ job, vName, product: "TRF01", status: null, driveFileId: null, scenarioFileId: null, notes: null, ...over });
  const bank = (job: string, vName: string, over = {}) => ({ job, vName, product: "TRF01", driveFileId: null, scenarioFileId: null, ...over });
  const known = (n: string) => ({ TRF01: "TRF01", "كمأة": "TRF01" })[n as "TRF01"] ?? null;

  it("adds a video the bank lacks, with its product resolved", () => {
    const p = planRegister([row("1", "V1", { product: "كمأة", status: "ready" })], [], known);
    expect(p.create).toEqual([expect.objectContaining({ job: "1", vName: "V1", product: "TRF01", status: "ready" })]);
  });

  it("a product the app does not know creates nothing and is named", () => {
    const p = planRegister([row("1", "V1", { product: "شي غريب" }), row("2", "V2", { product: null })], [], known);
    expect(p.create).toEqual([]);
    expect(p.unknownProducts).toEqual(["شي غريب"]);
    expect(p.untouched).toBe(2);
  });

  it("a video the bank has only gets its EMPTY fields filled", () => {
    const p = planRegister([row("1", "V1", { driveFileId: "NEWDRIVE", scenarioFileId: "NEWSCEN" }), row("2", "V2", { driveFileId: "NEWDRIVE2" })], [bank("1", "V1", { driveFileId: "MINE" }), bank("2", "V2")], known);
    expect(p.fill).toEqual([
      { job: "1", vName: "V1", data: { scenarioFileId: "NEWSCEN" } },
      { job: "2", vName: "V2", data: { driveFileId: "NEWDRIVE2" } },
    ]);
  });

  it("a row that changes nothing is untouched", () => {
    const p = planRegister([row("1", "V1", { status: "winner" })], [bank("1", "V1")], known);
    expect(p).toMatchObject({ create: [], fill: [], untouched: 1 });
  });
});

describe("the folders", () => {
  it("are found whatever the separators or the letters' spelling", () => {
    expect(sameName("06_الفيديوهات النهائية", DRIVE_FOLDERS.finals)).toBe(true);
    expect(sameName("06 الفيديوهات النهائيه", DRIVE_FOLDERS.finals)).toBe(true);
    expect(sameName("03-السيناريوهات", DRIVE_FOLDERS.scenarios)).toBe(true);
    expect(sameName("07_شي تاني", DRIVE_FOLDERS.finals)).toBe(false);
  });
});
