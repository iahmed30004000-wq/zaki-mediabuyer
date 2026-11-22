import { DoorCard } from "@/components/shell/door-card";
import { LoginForm } from "@/components/login-form";
import { safeNext } from "@/core/auth-guards";

export const metadata = { title: "الدخول" };

export default async function LoginPage({ searchParams: searchParamsP }: { searchParams: Promise<{ next?: string }> }) {
  const searchParams = await searchParamsP;
  const next = safeNext(searchParams.next);
  return (
    <DoorCard>
      <LoginForm next={next} />
    </DoorCard>
  );
}
