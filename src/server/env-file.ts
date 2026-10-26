/**
 * Edits `KEY=value` lines in a .env text — sets the given keys (replacing the line in place, or appending), removes
 * others, and leaves every other line, comment and blank exactly as it was. Pure: the caller reads and writes the file.
 */
export function setEnvLines(text: string, set: Record<string, string>, remove: string[] = []): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  const keyOf = (line: string) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1] ?? null;
  const pending = new Map(Object.entries(set));
  const drop = new Set(remove);
  const out: string[] = [];
  for (const line of lines) {
    const key = keyOf(line);
    if (key && drop.has(key)) continue;
    if (key && pending.has(key)) {
      out.push(`${key}=${pending.get(key)}`);
      pending.delete(key);
      continue;
    }
    out.push(line);
  }
  // Keep a trailing newline where the file had one, and put new keys before it.
  const trailing = out.length > 0 && out[out.length - 1] === "";
  if (trailing) out.pop();
  for (const [k, v] of pending) out.push(`${k}=${v}`);
  return out.join(eol) + (trailing || pending.size > 0 ? eol : "");
}
