import { createFileRoute } from "@tanstack/react-router";
import { ConnectorPage } from "@/components/nova/ConnectorViews";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/notion")({
  head: () => meta("Notion", "Notion workspace connector status and setup."),
  component: () => (
    <ConnectorPage id="notion" kicker="Workspace" demo={
      <ul className="space-y-1 text-sm"><li>Content Calendar — 14 rows</li><li>Brand Notes — 32 pages</li></ul>
    } />
  ),
});
