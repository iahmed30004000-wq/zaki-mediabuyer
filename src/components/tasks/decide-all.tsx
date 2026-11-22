"use client";

import { useRouter } from "next/navigation";
import { DecisionSheet } from "@/components/work/decision-sheet";
import type { JobView } from "@/lib/jobs-view";

/** «قرّر عليهم مرة وحدة»: the decision sheet (every job and its steps in one table — keep or cancel) inside «كل المهام»; closing it goes back to the list. */
export function DecideAll({ jobs }: { jobs: JobView[] }) {
  const router = useRouter();
  return <DecisionSheet jobs={jobs} onClose={() => router.replace("/tasks/all")} />;
}
