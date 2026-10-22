import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { actions, useNova, exportWorkspace, importWorkspace } from "@/lib/nova/store";
import { PageHeader, Panel } from "@/components/nova/ui";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/settings")({
  head: () => meta("Settings", "Language, direction and local workspace data."),
  component: SettingsPage,
});

function SettingsPage() {
  const lang = useNova((s) => s.lang);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function doExport() {
    const blob = new Blob([exportWorkspace()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nova-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const r = importWorkspace(text);
    setImportMsg(r.ok ? { ok: true, text: "Workspace imported." } : { ok: false, text: r.error });
  }

  return (
    <>
      <PageHeader kicker="Workspace" title="Settings" />
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Language / زبان">
          <div className="flex gap-2">
            <button className={`btn ${lang === "en" ? "btn-primary" : ""}`} onClick={() => actions.setLang("en")}>English (LTR)</button>
            <button className={`btn ${lang === "fa" ? "btn-primary" : ""}`} onClick={() => actions.setLang("fa")}>فارسی (RTL)</button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Persian switches layout to right-to-left and translates navigation.</p>
        </Panel>
        <Panel title="Data">
          <p className="text-sm text-muted-foreground">All tasks, content, projects and logs are stored in this browser only.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn" onClick={() => actions.clearDemo()}>Remove demo data</button>
            <button className="btn" onClick={() => { if (confirm("Reset the entire workspace? This cannot be undone.")) actions.reset(); }}>Reset workspace</button>
          </div>
        </Panel>
        <Panel title="Backup & restore" className="md:col-span-2">
          <p className="text-sm text-muted-foreground">Export a JSON snapshot of your local workspace, or restore one. Snapshots contain only your local data — never secrets or tokens.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={doExport}>Export JSON</button>
            <label className="btn cursor-pointer">
              Import JSON
              <input type="file" accept="application/json,.json" className="hidden" onChange={doImport} />
            </label>
          </div>
          {importMsg && (
            <p className={`mt-2 text-sm ${importMsg.ok ? "text-ok" : "text-destructive"}`}>{importMsg.text}</p>
          )}
        </Panel>
        <Panel title="Secrets" className="md:col-span-2">
          <p className="text-sm text-muted-foreground">API keys are never entered or stored here. Add them as server-side secrets (OPENAI_API_KEY, XAI_API_KEY, NOTION_API_KEY, GITHUB_API_KEY, LINKEDIN_ACCESS_TOKEN), then re-check status on each connector page.</p>
          <p className="mt-2 text-sm text-muted-foreground">GitHub, Notion, and LinkedIn writes are fail-closed. Enabling them requires a provisioned shared atomic store, authenticated user identity/ownership checks, and server-side grant, consume, revoke, expiry, and idempotency enforcement.</p>
        </Panel>
      </div>
    </>
  );
}
