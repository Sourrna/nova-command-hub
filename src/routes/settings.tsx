import { createFileRoute } from "@tanstack/react-router";
import { actions, useNova } from "@/lib/nova/store";
import { PageHeader, Panel } from "@/components/nova/ui";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/settings")({
  head: () => meta("Settings", "Language, direction and local workspace data."),
  component: SettingsPage,
});

function SettingsPage() {
  const lang = useNova((s) => s.lang);
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
        <Panel title="Secrets" className="md:col-span-2">
          <p className="text-sm text-muted-foreground">API keys are never entered or stored here. Add them as server-side secrets (OPENAI_API_KEY, XAI_API_KEY, NOTION_API_KEY, GITHUB_TOKEN, LINKEDIN_ACCESS_TOKEN), then re-check status on each connector page.</p>
        </Panel>
      </div>
    </>
  );
}
