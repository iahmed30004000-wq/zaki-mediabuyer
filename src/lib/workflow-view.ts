/**
 * The workflows as الورك فلو draws them: the real ones (MOCK_MODE=0), or — on the demo — the seeded jobs with no runs,
 * so the page shows what runs and when without pretending that anything ran.
 */
import { isValidCron, nextRuns } from "@/core/cron";
import { SEED_WORKFLOWS } from "@/core/workflow";
import { listWorkflows, type WorkflowCard } from "@/server/workflows";

export async function loadWorkflowCards(now = new Date()): Promise<{ cards: WorkflowCard[]; demo: boolean }> {
  if (process.env.MOCK_MODE !== "1") return { cards: await listWorkflows(now), demo: false };
  return {
    demo: true,
    cards: SEED_WORKFLOWS.map((s) => ({
      id: s.key,
      key: s.key,
      name: s.name,
      description: s.description,
      schedule: s.schedule,
      executor: s.executor,
      dataSource: "mcp",
      permission: s.permission,
      enabled: true,
      version: 1,
      graph: s.graph,
      nextRun: s.schedule && isValidCron(s.schedule) ? (nextRuns(s.schedule, now, 1)[0]?.toISOString() ?? null) : null,
      lastRun: null,
      live: null,
    })),
  };
}
