"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { ACTOR_KEY, TEAMS, type DirEntry } from "@/core/directory";
import { MCP_SCOPES, SCOPE_AR } from "@/core/token-scopes";
import { safeFetch } from "@/lib/call";

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const r = await safeFetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, data };
}

export interface LinkableUser {
  id: string;
  name: string;
  email: string;
}

function ActorRow({ actor, users, linkedTo }: { actor: DirEntry; users: LinkableUser[]; linkedTo: Set<string> }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(actor.name);
  const [team, setTeam] = useState(actor.team ?? "");
  const [chat, setChat] = useState("");
  const [user, setUser] = useState(actor.userId ?? "");
  const [busy, setBusy] = useState(false);

  async function save(patch: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const { ok, data } = await call(`/api/team/actors/${actor.key}`, "PATCH", patch);
      if (!ok) return toast(String(data.error ?? "صار خطأ"), "error");
      toast(done, "success");
      setChat("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span dir="ltr" className="text-sm font-bold text-fg-muted">{actor.key}</span>
        <Pill tone={actor.kind === "agent" ? "info" : "neutral"}>{actor.kind === "agent" ? "وكيل" : "شخص"}</Pill>
        {!actor.active ? <Pill tone="warn">مؤرشف</Pill> : null}
        {actor.hasTelegram ? <Pill tone="ok">تيليجرام مربوط</Pill> : null}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="الاسم">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field label="الفريق">
          <Select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">بلا فريق</option>
            {TEAMS.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="رقم محادثة تيليجرام" hint={actor.hasTelegram ? "مربوط — اكتب رقم جديد لتغييره" : "أرقام بس"}>
          <Input dir="ltr" inputMode="numeric" value={chat} onChange={(e) => setChat(e.target.value)} placeholder={actor.hasTelegram ? "••••••" : ""} />
        </Field>
        {actor.kind === "person" ? (
          <Field label="حساب الدخول" hint="بيحدد مهامه اللي بيشوفها">
            <Select value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">بلا حساب</option>
              {users.map((u) => (
                <option key={u.id} value={u.id} disabled={linkedTo.has(u.id) && u.id !== actor.userId}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={busy}
          onClick={() =>
            void save(
              {
                name: name.trim(),
                team: team || null,
                ...(chat.trim() ? { telegram: chat.trim() } : {}),
                ...(actor.kind === "person" ? { userId: user || null } : {}),
              },
              "انحفظ",
            )
          }
        >
          احفظ
        </Button>
        {actor.hasTelegram ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ telegram: null }, "انشال ربط تيليجرام")}>
            فكّ تيليجرام
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={busy} confirm={actor.active ? "تأرشفه؟ ما بينحذف، بس ما بيطلع بالقوائم." : undefined} onClick={() => void save({ active: !actor.active }, actor.active ? "انأرشف" : "رجع")}>
          {actor.active ? "أرشف" : "رجّع"}
        </Button>
      </div>
    </li>
  );
}

/** The team directory: people and agents as data. A name is written here, never in the code. */
export function ActorsPanel({ actors, users }: { actors: DirEntry[]; users: LinkableUser[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [n, setN] = useState({ key: "", name: "", kind: "person", team: "" });
  const [busy, setBusy] = useState(false);
  const linked = new Set(actors.map((a) => a.userId).filter((x): x is string => !!x));
  const keyOk = ACTOR_KEY.test(n.key);

  async function add() {
    setBusy(true);
    try {
      const { ok, data } = await call("/api/team/actors", "POST", { ...n, team: n.team || null });
      if (!ok) return toast(String(data.error ?? "صار خطأ"), "error");
      toast("انضاف", "success");
      setN({ key: "", name: "", kind: "person", team: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-card border border-border bg-surface-1">
        {actors.map((a) => (
          <ActorRow key={a.key} actor={a} users={users} linkedTo={linked} />
        ))}
      </ul>
      <div className="space-y-3 rounded-card border border-border bg-surface-1 p-4">
        <p className="text-base font-bold text-fg">ضيف شخص أو وكيل</p>
        <div className="grid gap-3 md:grid-cols-5 md:items-end">
          <Field label="المفتاح" hint="حروف إنجليزية صغيرة، ما بيتغيّر">
            <Input dir="ltr" value={n.key} onChange={(e) => setN({ ...n, key: e.target.value.toLowerCase() })} maxLength={32} />
          </Field>
          <Field label="الاسم">
            <Input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} maxLength={60} />
          </Field>
          <Field label="النوع">
            <Select value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value })}>
              <option value="person">شخص</option>
              <option value="agent">وكيل</option>
            </Select>
          </Field>
          <Field label="الفريق">
            <Select value={n.team} onChange={(e) => setN({ ...n, team: e.target.value })}>
              <option value="">بلا فريق</option>
              {TEAMS.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </Select>
          </Field>
          <Button loading={busy} disabled={!keyOk || !n.name.trim()} onClick={() => void add()}>
            ضيف
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  actorKey: string | null;
  actorName: string | null;
  lastUsed: string | null;
  revoked: boolean;
}

/** The agents' tokens: which agent each is, which doors it opens, last use — and a new one with exactly the scopes it needs. The secret shows once. */
export function AgentTokens({ agents, tokens }: { agents: { key: string; name: string }[]; tokens: TokenRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [agent, setAgent] = useState("");
  const [picked, setPicked] = useState<string[]>([...MCP_SCOPES]);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ token: string; url: string } | null>(null);
  const all = picked.length === MCP_SCOPES.length;

  async function make() {
    setBusy(true);
    try {
      const { ok, data } = await call("/api/mcp/tokens", "POST", { name: name.trim(), kind: "mcp", scopes: all ? undefined : picked, ...(agent ? { actorKey: agent } : {}) });
      if (!ok) return toast(String(data.error ?? "صار خطأ"), "error");
      setShown({ token: String(data.token), url: String(data.url) });
      setName("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    const { ok, data } = await call(`/api/mcp/tokens/${id}`, "DELETE");
    if (!ok) return toast(String(data.error ?? "صار خطأ"), "error");
    toast("انوقف التوكن", "success");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {tokens.length ? (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface-1">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-fg">{t.name}{t.actorName ? ` · ${t.actorName}` : ""}</span>
                <span className="block text-sm text-fg-muted">
                  <span dir="ltr">{t.prefix}…</span> · {t.scopes.map((s) => (SCOPE_AR as Record<string, string>)[s] ?? s).join(" · ")} · {t.lastUsed ? `آخر استعمال ${t.lastUsed}` : "ما انستعمل"}
                </span>
              </span>
              {t.revoked ? (
                <Pill tone="neutral">موقوف</Pill>
              ) : (
                <Button size="sm" variant="ghost" confirm="توقّفه؟ الوكيل ما بيقدر يشتغل فيه بعدين." onClick={() => void revoke(t.id)}>
                  أوقف
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">ما في توكنات لسا.</p>
      )}

      {shown ? (
        <div role="status" className="space-y-2 rounded-card border border-accent bg-surface-1 p-4">
          <p className="text-base font-bold text-fg">هاد التوكن بيظهر مرة وحدة بس — انسخه هلأ</p>
          <p dir="ltr" className="break-all rounded-lg bg-surface-2 p-2 text-start text-sm text-fg">{shown.token}</p>
          <p className="text-sm text-fg-muted">العنوان اللي بيتوصّل عليه الوكيل: <span dir="ltr">{shown.url}</span></p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(shown.token).then(() => toast("اننسخ", "success")).catch(() => undefined)}>
              انسخ
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShown(null)}>
              خلصت
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-3 rounded-card border border-border bg-surface-1 p-4">
        <p className="text-base font-bold text-fg">توكن جديد لوكيل</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="الاسم" hint="مثلاً: Claude الرئيسي">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          <Field label="الوكيل" hint="من دليل الفريق">
            <Select value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">بلا ربط</option>
              {agents.map((a) => (
                <option key={a.key} value={a.key}>{a.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-bold text-fg">شو بيقدر يستعمل</legend>
          <p className="text-sm text-fg-muted">{all ? "كل الأدوات (متل التوكنات القديمة)" : picked.length ? "بس اللي علّمته" : "علّم واحد على الأقل"}</p>
          <div className="grid gap-x-4 md:grid-cols-2">
            {MCP_SCOPES.map((s) => (
              <Checkbox key={s} label={SCOPE_AR[s]} checked={picked.includes(s)} onChange={(e) => setPicked(e.target.checked ? [...picked, s] : picked.filter((x) => x !== s))} />
            ))}
          </div>
        </fieldset>
        <Button loading={busy} disabled={!name.trim() || !picked.length} onClick={() => void make()}>
          اعمل التوكن
        </Button>
      </div>
    </div>
  );
}

export interface ConnectedRow {
  id: string;
  name: string;
  host: string;
  scopes: string[];
  connectedAt: string;
  lastUsedAt: string | null;
  active: boolean;
}

/** Apps the owner let in through the connector (claude.ai): who, when it last called, and a revoke that cuts it off on its very next call. */
export function ConnectedApps({ clients, url }: { clients: ConnectedRow[]; url: string }) {
  const router = useRouter();
  const { toast } = useToast();
  async function revoke(id: string) {
    const { ok, data } = await call(`/api/mcp/oauth-clients/${id}`, "DELETE");
    if (!ok) return toast(String(data.error ?? "صار خطأ"), "error");
    toast("انقطع التطبيق", "success");
    router.refresh();
  }
  return (
    <div className="space-y-3">
      <div className="space-y-1 rounded-card border border-border bg-surface-1 p-4 text-sm">
        <p className="font-bold text-fg">لإضافة Claude كموصّل</p>
        <p className="text-fg-muted">
          بـ claude.ai ← الإعدادات ← الموصّلات ← «إضافة موصّل مخصّص»، الصق هالعنوان: <span dir="ltr" className="tabular-nums font-bold text-fg">{url}</span>. بيفتحلك الموقع لتوافق، وبعدها بيشتغل لحاله.
        </p>
      </div>
      {clients.length ? (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface-1">
          {clients.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-fg">{c.name} <span dir="ltr" className="tabular-nums text-xs font-normal text-fg-muted">{c.host}</span></span>
                <span className="block text-sm text-fg-muted">
                  {c.scopes.map((s) => (SCOPE_AR as Record<string, string>)[s] ?? s).join(" · ") || "ما إله صلاحيات"} · {c.lastUsedAt ? `آخر نداء ${new Date(c.lastUsedAt).toLocaleString("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" })}` : "ما نادى لسا"}
                </span>
              </span>
              {c.active ? (
                <Button size="sm" variant="ghost" confirm="تقطع هالتطبيق؟ ما بيقدر يشتغل بعدها إلا إذا وافقت من جديد." onClick={() => void revoke(c.id)}>
                  اقطع
                </Button>
              ) : (
                <Pill tone="neutral">مقطوع</Pill>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">ما في تطبيق متصل بالموصّل لسا.</p>
      )}
    </div>
  );
}
