// Connector registry: typed, extensible. Adding a connector = adding an entry here.
export type ConnectorStatus = "connected" | "needs_setup" | "limited" | "disconnected";
export type Capability = "read" | "write" | "publish" | "generate" | "sync";
export type ConnectorId = "openai" | "xai" | "notion" | "lovable" | "github" | "linkedin";

export interface ConnectorDef {
  id: ConnectorId;
  name: string;
  category: "ai" | "workspace" | "code" | "social" | "builder";
  description: string;
  capabilities: { kind: Capability; label: string; gated: boolean }[];
  /** Server-side env var names checked for presence only. Values never leave the server. */
  secrets: string[];
  setup: string[];
  docs: string;
}

export const CONNECTORS: ConnectorDef[] = [
  {
    id: "openai", name: "OpenAI / ChatGPT", category: "ai",
    description: "Drafting, strategy and summarisation models.",
    capabilities: [{ kind: "generate", label: "Generate drafts", gated: false }],
    secrets: ["OPENAI_API_KEY"],
    setup: ["Create an API key at platform.openai.com", "Add it as server secret OPENAI_API_KEY", "Re-check status here"],
    docs: "https://platform.openai.com/docs",
  },
  {
    id: "xai", name: "xAI / Grok", category: "ai",
    description: "Alternative model for trend-aware ideation.",
    capabilities: [{ kind: "generate", label: "Generate ideas", gated: false }],
    secrets: ["XAI_API_KEY"],
    setup: ["Create an API key at console.x.ai", "Add it as server secret XAI_API_KEY", "Re-check status here"],
    docs: "https://docs.x.ai",
  },
  {
    id: "notion", name: "Notion", category: "workspace",
    description: "Search shared Notion pages and data sources with live read access.",
    capabilities: [
      { kind: "read", label: "Search pages / data sources", gated: false },
      { kind: "write", label: "Create / update pages", gated: true },
    ],
    secrets: ["NOTION_API_KEY"],
    setup: ["Use the linked Notion connection, or a Notion-issued integration token with NOTION_API_MODE=direct", "Share target pages and databases with the integration", "Credentials must be available as server request bindings; writes are not implemented"],
    docs: "https://developers.notion.com",
  },
  {
    id: "lovable", name: "Lovable", category: "builder",
    description: "Build surface hosting this cockpit. No public write API is used.",
    capabilities: [{ kind: "read", label: "Host this app", gated: false }],
    secrets: [],
    setup: ["Runs inside Lovable — no credentials required", "Programmatic project control is not available"],
    docs: "https://docs.lovable.dev",
  },
  {
    id: "github", name: "GitHub", category: "code",
    description: "Track repositories, issues and releases for projects.",
    capabilities: [
      { kind: "read", label: "Read repos & issues", gated: false },
      { kind: "write", label: "Open issues / PRs", gated: true },
    ],
    secrets: [],
    setup: ["Linked via the Lovable GitHub connector (server-side only)", "Reads Sourrna/nova-brand-ai; writes not implemented"],
    docs: "https://docs.github.com/rest",
  },
  {
    id: "linkedin", name: "LinkedIn", category: "social",
    description: "Publish approved posts and pull basic metrics.",
    capabilities: [
      { kind: "publish", label: "Publish posts", gated: true },
      { kind: "read", label: "Read post metrics", gated: false },
    ],
    secrets: ["LINKEDIN_ACCESS_TOKEN"],
    setup: ["Create a LinkedIn app with w_member_social scope", "Complete OAuth and store LINKEDIN_ACCESS_TOKEN server-side", "Metrics require Community Management API approval"],
    docs: "https://learn.microsoft.com/linkedin",
  },
];

export const STATUS_META: Record<ConnectorStatus, { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "ok" },
  limited: { label: "Limited", tone: "warn" },
  needs_setup: { label: "Needs setup", tone: "idle" },
  disconnected: { label: "Disconnected", tone: "bad" },
};

export function getConnector(id: ConnectorId) {
  const connector = CONNECTORS.find((c) => c.id === id);
  if (!connector) throw new Error("Unknown connector");
  return connector;
}
