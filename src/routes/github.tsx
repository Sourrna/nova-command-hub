import { createFileRoute } from "@tanstack/react-router";
import { ConnectorPage } from "@/components/nova/ConnectorViews";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/github")({
  head: () => meta("GitHub", "GitHub connector status, setup and capabilities."),
  component: () => (
    <ConnectorPage id="github" kicker="Code" demo={
      <ul className="space-y-1 text-sm"><li>nova-site — 3 open issues</li><li>speaking-kit — last push 4d ago</li></ul>
    } />
  ),
});
