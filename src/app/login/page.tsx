import { DoorCard } from "@/components/shell/door-card";
import { LoginForm } from "@/components/login-form";
import { safeNext } from "@/core/auth-guards";

export const metadata = { title: "الدخول" };

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  const next = safeNext(searchParams.next);
  return (
    <DoorCard>
      <LoginForm next={next} />
    </DoorCard>
  );
}
