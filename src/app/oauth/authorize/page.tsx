import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { MediaBuyerMark } from "@/components/logo";
import { can } from "@/core/roles";
import { SCOPE_AR } from "@/core/token-scopes";
import { currentCaller } from "@/server/auth";
import { checkAuthRequest } from "@/server/oauth";

export const metadata = { title: "موافقة على ربط" };
export const dynamic = "force-dynamic";

/** One short screen, in the middle: «هل بدك تسمح لـ … توصل للميديا باير؟» — the scopes in plain words, and two buttons. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-8">
      <div className="flex items-center gap-3">
        <MediaBuyerMark className="size-10" />
        <p className="text-xl font-extrabold text-fg">الميديا باير</p>
      </div>
      {children}
    </main>
  );
}

export default async function AuthorizePage({ searchParams: searchParamsP }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await searchParamsP;
  const me = await currentCaller();
  const checked = await checkAuthRequest(searchParams);
  if (!checked.ok) {
    return (
      <Shell>
        <Card>
          <CardBody className="space-y-2">
            <h1 className="text-xl font-extrabold text-fg">الطلب مش صالح</h1>
            <p className="text-sm text-fg-muted">{checked.why}. ما صار شي، وما انعطى حدا صلاحية. ارجع للتطبيق وجرّب تربط من جديد.</p>
          </CardBody>
        </Card>
      </Shell>
    );
  }
  const r = checked.req;
  if (!me || me.demo || !can(me.role, "owner_only")) {
    return (
      <Shell>
        <Card>
          <CardBody className="space-y-2">
            <h1 className="text-xl font-extrabold text-fg">الموافقة للمالك</h1>
            <p className="text-sm text-fg-muted">{me?.demo ? "الموقع بلا تسجيل دخول، فما بينفع تربط عليه." : "حسابك ما بيسمح تربط تطبيق. اطلب من المالك."}</p>
          </CardBody>
        </Card>
      </Shell>
    );
  }
  const hidden = { client_id: r.clientId, redirect_uri: r.redirectUri, code_challenge: r.challenge, scope: r.scopes.join(" "), state: r.state ?? "" };
  return (
    <Shell>
      <Card>
        <CardBody className="space-y-4">
          <div className="space-y-1">
            <h1 className="text-xl font-extrabold text-fg">تسمح لـ «{r.clientName}» تتصل؟</h1>
            <p className="text-sm text-fg-muted">
              بيرجع لـ <span dir="ltr" className="font-bold">{r.redirectHost}</span> بعد موافقتك. بيشتغل كالوكيل <span dir="ltr" className="font-bold">claude</span>، وبيقدر بس على:
            </p>
          </div>
          <ul className="space-y-1.5 text-sm text-fg">
            {r.scopes.map((s) => (
              <li key={s} className="flex gap-2">
                <span aria-hidden>•</span>
                <span>{SCOPE_AR[s]}</span>
              </li>
            ))}
          </ul>
          <p className="rounded-lg bg-surface-2 p-3 text-xs leading-5 text-fg-muted">ما بيقدر يصرف ولا يغيّر شي على ميتا، وكل طلب موافقة بيطلع عندك بـ «بانتظارك». بتقدر تشيله وقت ما بدك من الإعدادات ← الفريق ← توكنات الوكلاء.</p>
          <form method="post" action="/oauth/authorize/decide" className="flex flex-wrap gap-2">
            {Object.entries(hidden).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <Button type="submit" name="decision" value="approve">
              اسمح
            </Button>
            <Button type="submit" name="decision" value="deny" variant="secondary">
              لا
            </Button>
          </form>
        </CardBody>
      </Card>
    </Shell>
  );
}
