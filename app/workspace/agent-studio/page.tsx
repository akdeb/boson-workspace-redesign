import { AgentLandingPage } from "@/components/agent-studio";

export default async function AgentStudioPage({ searchParams }: PageProps<"/workspace/agent-studio">) {
  // `?create=1` is how "New agent" elsewhere in the app lands here with the builder open.
  const { create } = await searchParams;
  return <AgentLandingPage startCreating={create === "1"} />;
}
