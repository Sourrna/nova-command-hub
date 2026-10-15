import { queryOptions, useQuery } from "@tanstack/react-query";
import { getConnectorHealth, type ConnectorHealth } from "./status.functions";
import { useNova } from "./store";
import type { ConnectorId } from "./connectors";

export const healthQuery = queryOptions({ queryKey: ["connector-health"], queryFn: () => getConnectorHealth(), staleTime: 60_000 });

/** Server health merged with user's local disconnect toggles. */
export function useHealth() {
  const q = useQuery(healthQuery);
  const disabled = useNova((s) => s.disabled);
  const map = new Map<ConnectorId, ConnectorHealth>();
  (q.data ?? []).forEach((h) => map.set(h.id, disabled.includes(h.id) ? { ...h, status: "disconnected", reason: "Disconnected by you in this workspace." } : h));
  return { ...q, get: (id: ConnectorId): ConnectorHealth => map.get(id) ?? { id, status: "needs_setup", reason: q.isLoading ? "Checking…" : "Unknown", missing: [] } };
}
