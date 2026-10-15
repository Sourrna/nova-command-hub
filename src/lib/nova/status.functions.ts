import { createServerFn } from "@tanstack/react-start";
import { CONNECTORS, type ConnectorId, type ConnectorStatus } from "./connectors";

export interface ConnectorHealth {
  id: ConnectorId;
  status: ConnectorStatus;
  reason: string;
  missing: string[];
}

// Presence check only: reports which env names exist, never their values.
// A present key is reported as "limited" (unverified) — we never claim a live connection
// without a successful provider call.
export const getConnectorHealth = createServerFn({ method: "GET" }).handler(async () => {
  return CONNECTORS.map<ConnectorHealth>((c) => {
    if (c.id === "lovable")
      return { id: c.id, status: "limited", reason: "Hosting only; no programmatic API.", missing: [] };
    const missing = c.secrets.filter((s) => !process.env[s]);
    if (missing.length)
      return { id: c.id, status: "needs_setup", reason: `Missing ${missing.join(", ")}`, missing };
    return { id: c.id, status: "limited", reason: "Credential present but not yet verified by a live call.", missing: [] };
  });
});
