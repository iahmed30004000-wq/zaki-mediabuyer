import { ButtonLink } from "@/components/ui/button-link";
import { DoorCard } from "@/components/shell/door-card";

export default function NotFound() {
  return (
    <DoorCard>
      <div className="space-y-3 rounded-card border border-border bg-surface-1 p-5 text-center shadow-card">
        <p className="text-lg font-bold text-fg">هالصفحة مش موجودة</p>
        <p className="text-sm text-fg-muted">يمكن الرابط قديم. ارجع للرئيسية ومن هناك كل شي بإيدك.</p>
        <ButtonLink href="/">ارجع للرئيسية</ButtonLink>
      </div>
    </DoorCard>
  );
}
