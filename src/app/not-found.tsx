import Link from "next/link";
import { DoorShell } from "@/components/theme/door-shell";

export default function NotFound() {
  return (
    <DoorShell>
      <div className="space-y-3 rounded-card border border-border bg-surface-1 p-5 text-center shadow-card">
        <p className="text-lg font-bold text-fg">هالصفحة مش موجودة</p>
        <p className="text-sm text-fg-muted">يمكن الرابط قديم. ارجع لـ «اليوم» ومن هناك كل شي بإيدك.</p>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg">ارجع لليوم</Link>
      </div>
    </DoorShell>
  );
}
