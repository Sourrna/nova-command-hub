import { createServerFn } from "@tanstack/react-start";
import { CONNECTORS, type ConnectorId, type ConnectorStatus } from "./connectors";
import { testProvider } from "./ai.server";

export interface ConnectorHealth {
  id: ConnectorId;
  status: ConnectorStatus;
  reason: string;
  missing: string[];
}

// AI connectors are verified with a live authenticated call; "connected" only on success.
// Others: presence check only — never reported connected without a live adapter.
export const getConnectorHealth = createServerFn({ method: "GET" }).handler(async () => {
  return Promise.all(CONNECTORS.map<Promise<ConnectorHealth>>(async (c) => {
    if (c.id === "lovable")
      return { id: c.id, status: "limited", reason: "Hosting only; no programmatic API.", missing: [] };
    if (c.id === "github") {
      const { ghGet, GH_REPO } = await import("./github.server");
      const r = await ghGet(`repos/${GH_REPO}`);
      if (r.ok) return { id: c.id, status: "connected", reason: `Read access to ${GH_REPO} verified live.`, missing: [] };
      if (r.code === "missing") return { id: c.id, status: "needs_setup", reason: r.error, missing: ["GITHUB_API_KEY"] };
      return { id: c.id, status: r.code === "auth" ? "disconnected" : "limited", reason: r.error, missing: [] };
    }
    const missing = c.secrets.filter((s) => !process.env[s]);
    if (missing.length)
      return { id: c.id, status: "needs_setup", reason: `Missing ${missing.join(", ")}`, missing };
    if (c.id === "openai" || c.id === "xai") {
      const r = await testProvider(c.id, process.env[c.secrets[0]!]);
      if (r.ok) return { id: c.id, status: "connected", reason: "Verified by a live API call.", missing: [] };
      return { id: c.id, status: r.code === "auth" ? "disconnected" : "limited", reason: r.error, missing: [] };
    }
    return { id: c.id, status: "limited", reason: "Credential present; live adapter not implemented yet.", missing: [] };
  }));
});
