/**
 * `npm run oms:link [https://crm.zakiai.io]` — links the media buyer to the OMS read API (P0.3), on this machine only.
 *
 *   1. asks for the OMS address (or takes it as the argument) and the key made on the OMS token screen
 *      («الميديا باير»). The key is typed hidden and never printed, logged or sent anywhere but the OMS;
 *   2. seals it with ENCRYPTION_KEY and writes OMS_BASE_URL + OMS_TOKEN_ENC into .env (a plaintext OMS_TOKEN line is
 *      removed);
 *   3. reads the OMS catalogue once with the key, and says how many products came back — or why it failed.
 * The switch stays yours: set OMS_LIVE=1 in .env when you want the hourly sync to use it.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { encryptSecrets, encryptionKeyConfigured } from "../src/server/crypto";
import { setEnvLines } from "../src/server/env-file";
import { readProducts } from "../src/adapters/oms";

const ENV = ".env";

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Echo nothing while the key is typed: no character of it reaches the terminal or its scrollback.
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.startsWith(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

(async () => {
  if (!encryptionKeyConfigured()) {
    console.error("✗ ENCRYPTION_KEY مش معبّى بـ .env — من دونه ما بنخزّن المفتاح.");
    process.exit(1);
  }
  const baseUrl = (process.argv[2] ?? (await ask("عنوان الـ OMS المحلي (مثال http://localhost:3001): "))).replace(/\/+$/, "");
  try {
    const u = new URL(baseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    // Local first (the owner's rule of 26/10): another host only once he set OMS_ALLOW_REMOTE=1, and then https only.
    if (!local && process.env.OMS_ALLOW_REMOTE?.trim() !== "1") {
      console.error("✗ لهلأ الربط مع الـ OMS المحلي بس (localhost). الإنتاج بقرار المالك: OMS_ALLOW_REMOTE=1 بـ .env.");
      process.exit(1);
    }
    if (!local && u.protocol !== "https:") throw new Error("not https");
  } catch {
    console.error("✗ العنوان لازم يكون رابط كامل (https لأي جهاز غير هالجهاز).");
    process.exit(1);
  }
  const token = await ask("مفتاح الميديا باير من شاشة توكنات الأنظمة (ما رح يبين وانت بتكتب): ", true);
  if (!/^zk1_[A-Za-z0-9_-]{20,}$/.test(token)) {
    console.error("✗ هاد مش شكل مفتاح OMS (بيبلش بـ zk1_).");
    process.exit(1);
  }

  const text = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
  writeFileSync(ENV, setEnvLines(text, { OMS_BASE_URL: baseUrl, OMS_TOKEN_ENC: encryptSecrets({ token }) }, ["OMS_TOKEN"]));
  console.log("✓ انحفظ العنوان والمفتاح مشفّر بـ .env");

  try {
    const products = await readProducts({ baseUrl, token });
    console.log(`✓ الـ OMS ردّ: ${products.length} منتج. حط OMS_LIVE=1 بـ .env لتبلش المزامنة كل ساعة.`);
  } catch (e) {
    // The adapter's message names the path and the status only — never the key.
    console.error(`✗ الـ OMS ما ردّ صح: ${e instanceof Error ? e.message : "خطأ"} — تأكد إن المفتاح شغّال وإن إله صلاحيات الميديا باير.`);
    process.exit(2);
  }
})();
