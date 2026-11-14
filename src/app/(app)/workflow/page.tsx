import { EmptyState } from "@/components/ui/card";

export const metadata = { title: "الورك فلو" };
export const dynamic = "force-dynamic";

/** الورك فلو: the work that runs — who does it, when, and what came out. (Filled by the next steps of v3/v4.) */
export default function WorkflowPage() {
  return <EmptyState title="ما في تشغيلات لسا" hint="أول ما يبدأ أي تشغيل — من Claude أو من العامل — بيظهر هون مع خطواته." art="empty-decisions" />;
}
