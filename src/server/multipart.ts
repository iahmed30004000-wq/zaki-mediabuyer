/**
 * A multipart/form-data reader that never holds the file in memory (ENGINEER_ONBOARDING F-10): `req.formData()` buffers
 * the whole body, and the studio sends up to 500 MB. Here the body is read chunk by chunk; the one file part goes to disk
 * through a hash, the small text parts are kept (each capped), and the size limit is enforced while reading — and
 * checked first against Content-Length — so a huge upload is cut off instead of filling the disk or the memory.
 */
import { createHash } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

export class MultipartError extends Error {
  constructor(public code: "malformed" | "file_too_large" | "field_too_large", message: string) {
    super(message);
  }
}

export interface MultipartOptions {
  /** the part carrying the file */
  fileField: string;
  /** where the file is written (its folder is created) */
  filePath: string;
  maxFileBytes: number;
  /** cap for every text part */
  maxFieldBytes: number;
}

export interface MultipartResult {
  fields: Record<string, string>;
  file: { bytes: number; sha256: string; filename: string | null } | null;
}

const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");
const MAX_HEADER_BYTES = 16 * 1024;

export function boundaryOf(contentType: string | null): string | null {
  const m = /^multipart\/form-data\s*;.*?\bboundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? "");
  const b = m?.[1] ?? m?.[2] ?? null;
  return b && b.length <= 200 ? b : null;
}

/**
 * Reads `body` (the request stream). On any error the partly written file is removed. The file part is the one named
 * `fileField` that carries a filename; every other part is a text field (last one wins).
 */
export async function readMultipart(body: AsyncIterable<Uint8Array> | null, boundary: string, o: MultipartOptions): Promise<MultipartResult> {
  if (!body) throw new MultipartError("malformed", "الطلب فاضي");
  const delim = Buffer.from(`\r\n--${boundary}`);
  const fields: Record<string, string> = {};
  let file: MultipartResult["file"] = null;

  type State = "preamble" | "after_delim" | "headers" | "body";
  let state: State = "preamble";
  // The first delimiter has no CRLF before it, so pretend one was sent.
  let buf: Buffer = Buffer.from(CRLF);
  let current: { kind: "skip" } | { kind: "text"; name: string; chunks: Buffer[]; bytes: number } | { kind: "file"; filename: string | null; bytes: number } = { kind: "skip" };
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  const hash = createHash("sha256");
  let done = false;

  const emit = async (data: Buffer) => {
    if (!data.length) return;
    if (current.kind === "text") {
      current.bytes += data.length;
      if (current.bytes > o.maxFieldBytes) throw new MultipartError("field_too_large", "حقل نصي أكبر من المسموح");
      current.chunks.push(data);
    } else if (current.kind === "file") {
      current.bytes += data.length;
      if (current.bytes > o.maxFileBytes) throw new MultipartError("file_too_large", "الملف أكبر من المسموح");
      hash.update(data);
      await handle!.write(data);
    }
  };

  const finishPart = async () => {
    if (current.kind === "text") fields[current.name] = Buffer.concat(current.chunks).toString("utf8");
    else if (current.kind === "file") {
      await handle!.close();
      handle = null;
      file = { bytes: current.bytes, sha256: hash.digest("hex"), filename: current.filename };
    }
    current = { kind: "skip" };
  };

  const startPart = async (rawHeaders: string) => {
    const disp = /^content-disposition:\s*form-data;([^\r\n]*)/im.exec(rawHeaders);
    const name = /\bname="([^"]*)"/i.exec(disp?.[1] ?? "")?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disp?.[1] ?? "")?.[1] ?? null;
    if (name === undefined) throw new MultipartError("malformed", "جزء بلا اسم");
    if (name === o.fileField && filename !== null) {
      if (file || handle) throw new MultipartError("malformed", "ملف مكرر");
      await mkdir(path.dirname(o.filePath), { recursive: true });
      handle = await open(o.filePath, "w");
      current = { kind: "file", filename, bytes: 0 };
    } else if (filename !== null) {
      current = { kind: "skip" }; // some other file: drained, not kept
    } else {
      current = { kind: "text", name, chunks: [], bytes: 0 };
    }
  };

  const step = async (): Promise<boolean> => {
    // returns true when it made progress and may run again on the same buffer
    if (state === "body" || state === "preamble") {
      const i = buf.indexOf(delim);
      if (i >= 0) {
        if (state === "body") await emit(buf.subarray(0, i));
        await finishPart();
        buf = buf.subarray(i + delim.length);
        state = "after_delim";
        return true;
      }
      // keep a tail that might be the start of a delimiter
      const keep = Math.min(buf.length, delim.length - 1);
      if (state === "body") await emit(buf.subarray(0, buf.length - keep));
      buf = buf.subarray(buf.length - keep);
      return false;
    }
    if (state === "after_delim") {
      if (buf.length < 2) return false;
      if (buf[0] === 0x2d && buf[1] === 0x2d) {
        done = true;
        return false;
      }
      if (buf[0] === 0x0d && buf[1] === 0x0a) {
        buf = buf.subarray(2);
        state = "headers";
        return true;
      }
      throw new MultipartError("malformed", "بنية الطلب غلط");
    }
    // headers
    const i = buf.indexOf(HEADER_END);
    if (i < 0) {
      if (buf.length > MAX_HEADER_BYTES) throw new MultipartError("malformed", "ترويسة الجزء كبيرة");
      return false;
    }
    await startPart(buf.subarray(0, i).toString("utf8"));
    buf = buf.subarray(i + HEADER_END.length);
    state = "body";
    return true;
  };

  try {
    for await (const chunk of body) {
      if (done) break;
      buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
      while (!done && (await step())) {
        /* keep consuming the buffer */
      }
    }
    if (!done) throw new MultipartError("malformed", "الطلب انقطع قبل نهايته");
    return { fields, file };
  } catch (e) {
    if (handle) await (handle as Awaited<ReturnType<typeof open>>).close().catch(() => undefined);
    await rm(o.filePath, { force: true });
    throw e;
  }
}
