import { AgentDetailPage } from "@/components/agent-studio";

export default async function AgentPage({ params, searchParams }: PageProps<"/workspace/agent-studio/[agentId]">) {
  const { agentId } = await params;
  // `?call=1` is how the agent list's quick-call button lands you straight in the drawer.
  const { call } = await searchParams;
  return <AgentDetailPage agentId={agentId} startInCall={call === "1"} />;
}
