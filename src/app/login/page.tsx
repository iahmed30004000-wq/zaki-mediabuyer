import { DoorCard } from "@/components/shell/door-card";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "الدخول" };

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  const next = searchParams.next?.startsWith("/") && !searchParams.next.startsWith("//") ? searchParams.next : "/";
  return (
    <DoorCard>
      <LoginForm next={next} />
    </DoorCard>
  );
}
