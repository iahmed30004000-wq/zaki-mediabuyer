import { DoorShell } from "@/components/theme/door-shell";
import { SetupChecklist } from "@/components/setup/setup-checklist";
import { SETUP_STEPS } from "@/lib/mock/data";

export const metadata = { title: "جهّز النظام" };

/** «جهّز النظام» — the prerequisites of spec section 2, one step at a time, at the door (the calm screen). */
export default function SetupPage() {
  return (
    <DoorShell width="md">
      <SetupChecklist steps={SETUP_STEPS} />
    </DoorShell>
  );
}
