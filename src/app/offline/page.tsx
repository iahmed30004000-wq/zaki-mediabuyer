import { WifiOff } from "lucide-react";

export const metadata = { title: "ما في نت" };

/** Shown by the service worker when there is no internet and the page was never opened before (spec 18.5). */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <WifiOff className="size-10 text-fg-muted" />
      <h1 className="text-lg font-semibold text-fg">ما في نت هلأ</h1>
      <p className="text-sm text-fg-muted">الصفحات اللي فتحتها قبل بتنفتح من آخر نسخة، وآخر تقرير موجود بـ «التقارير». الموافقات والإيقاف بدهم نت — ولا شي بينبعت وإنت مقطوع.</p>
      <a href="/reports" className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg">افتح آخر تقرير</a>
    </main>
  );
}
