import { createFileRoute } from "@tanstack/react-router";
import { ConnectorPage } from "@/components/nova/ConnectorViews";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/lovable")({
  head: () => meta("Lovable", "Lovable build surface status."),
  component: () => <ConnectorPage id="lovable" kicker="Builder" />,
});
