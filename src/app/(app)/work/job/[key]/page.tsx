import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The page of one job. Until P5 builds it, it opens the drawing board (the only screen a job has). */
export default function JobPage({ params }: { params: { key: string } }) {
  redirect(`/work/job/${encodeURIComponent(params.key)}/draw`);
}
