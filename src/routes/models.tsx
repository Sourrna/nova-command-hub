import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/nova/ui";
import { ConnectorDetail } from "@/components/nova/ConnectorViews";
import { AiGenerator } from "@/components/nova/AiGenerator";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/models")({
  head: () => meta("AI Models", "OpenAI/ChatGPT and xAI/Grok model connections."),
  component: () => (
    <>
      <PageHeader kicker="Intelligence layer" title="AI Models" />
      <div className="mb-8"><AiGenerator /></div>
      <h2 className="label-hud mb-2">OpenAI / ChatGPT</h2>
      <ConnectorDetail id="openai" />
      <h2 className="label-hud mb-2 mt-8">xAI / Grok</h2>
      <ConnectorDetail id="xai" />
    </>
  ),
});
