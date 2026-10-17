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
    if (c.id === "notion") {
      const [{ searchNotion }, { getNotionCredentials }] = await Promise.all([import("./notion.server"), import("./notion-runtime.server")]);
      const r = await searchNotion(getNotionCredentials());
      if (r.ok) return { id: c.id, status: "connected", reason: "Read access verified by a live Notion search.", missing: [] };
      return { id: c.id, status: r.code === "missing" ? "needs_setup" : r.code === "auth" ? "disconnected" : "limited", reason: r.error, missing: r.code === "missing" ? ["NOTION_API_KEY"] : [] };
    }
    const missing = c.secrets.filter((s) => !process.env[s]);
    if (missing.length)
      return { id: c.id, status: "needs_setup", reason: `Missing ${missing.join(", ")}`, missing };
    if (c.id === "openai" || c.id === "xai") {
      const secretName = c.secrets[0];
      const r = await testProvider(c.id, secretName ? process.env[secretName] : undefined);
      if (r.ok) return { id: c.id, status: "connected", reason: "Verified by a live API call.", missing: [] };
      return { id: c.id, status: r.code === "auth" ? "disconnected" : "limited", reason: r.error, missing: [] };
    }
    return { id: c.id, status: "limited", reason: "Credential present; live adapter not implemented yet.", missing: [] };
  }));
});
