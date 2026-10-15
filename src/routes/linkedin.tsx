import { createFileRoute } from "@tanstack/react-router";
import { ConnectorPage } from "@/components/nova/ConnectorViews";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/linkedin")({
  head: () => meta("LinkedIn", "LinkedIn publishing connector status and setup."),
  component: () => (
    <ConnectorPage id="linkedin" kicker="Social" demo={
      <ul className="space-y-1 text-sm"><li>Last post — 1,204 impressions · 38 reactions</li><li>Follower growth (30d) — +112</li></ul>
    } />
  ),
});
