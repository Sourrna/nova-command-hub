import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2 } from "lucide-react";
import { AI_MODELS, generateAi } from "@/lib/nova/ai.functions";
import { useHealth } from "@/lib/nova/health";
import { update } from "@/lib/nova/store";
import { Panel } from "./ui";

type P = "openai" | "xai";

export function AiGenerator() {
  const gen = useServerFn(generateAi);
  const health = useHealth();
  const [provider, setProvider] = useState<P>("openai");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [out, setOut] = useState<{ text: string; model: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const h = health.get(provider);
  const ready = h.status === "connected";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) { setErr("Prompt is required."); return; }
    setBusy(true); setErr(""); setOut(null); setCopied(false);
    try {
      const r = await gen({ data: { provider, model: model || undefined, prompt } });
      if (r.ok) { setOut(r.value); update(() => ({}), `AI generation via ${provider === "openai" ? "OpenAI" : "xAI"} (${r.value.model})`, "info"); }
      else setErr(r.error);
    } catch (e) { setErr(e instanceof Error ? e.message : "Request failed."); }
    finally { setBusy(false); }
  }

  return (
    <Panel title="Generate">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <select className="field w-40" value={provider} onChange={(e) => { setProvider(e.target.value as P); setModel(""); }} aria-label="Provider">
            <option value="openai">OpenAI</option><option value="xai">xAI / Grok</option>
          </select>
          <select className="field w-44" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
            <option value="">Default ({AI_MODELS[provider][0]})</option>
            {AI_MODELS[provider].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <textarea className="field min-h-28 w-full" value={prompt} maxLength={8000} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe what to draft…" aria-label="Prompt" />
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" disabled={busy || !ready} aria-busy={busy}>
            {busy && <Loader2 size={14} className="animate-spin" />}{busy ? "Generating…" : "Generate"}
          </button>
          {!ready && <span className="text-xs text-muted-foreground">Unavailable: {h.reason}</span>}
        </div>
      </form>
      {err && <p role="alert" className="mt-3 rounded-md border border-destructive/50 p-3 text-sm text-destructive">{err}</p>}
      {out && (
        <div className="mt-3 rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between"><span className="label-hud">{out.model}</span>
            <button type="button" className="btn btn-ghost !py-0.5 text-xs" onClick={() => navigator.clipboard.writeText(out.text).then(() => setCopied(true))}><Copy size={12} />{copied ? "Copied" : "Copy"}</button>
          </div>
          <p className="whitespace-pre-wrap text-sm">{out.text}</p>
        </div>
      )}
    </Panel>
  );
}
