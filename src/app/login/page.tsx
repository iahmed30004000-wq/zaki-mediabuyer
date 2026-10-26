import { DoorShell } from "@/components/theme/door-shell";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "الدخول" };

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  const next = searchParams.next?.startsWith("/") && !searchParams.next.startsWith("//") ? searchParams.next : "/";
  return (
    <DoorShell>
      <LoginForm next={next} />
    </DoorShell>
  );
}
