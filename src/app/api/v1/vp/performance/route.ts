/** The same rows under the name in the studio's contracts/vp-ops.v1.yaml (`since` may carry a time; until = today). */
import { GET as performance } from "@/app/api/vidpattern/ad-performance/route";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  if (since) url.searchParams.set("since", since.slice(0, 10));
  return performance(new Request(url, { headers: req.headers }));
}
