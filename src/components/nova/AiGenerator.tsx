import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, Check } from "lucide-react";
import { generateAi } from "@/lib/nova/ai.functions";
import { AI_MODELS } from "@/lib/nova/ai-models";
import { useHealth } from "@/lib/nova/health";
import { update } from "@/lib/nova/store";
import { Panel } from "./ui";

type P = "openai" | "xai";

/** Props for the inline generator. `onDraft` turns generated text into a
 * content idea in one click — no copy/paste round-trip. */
export function AiGenerator({ onDraft }: { onDraft?: (title: string, body: string) => void }) {
  const gen = useServerFn(generateAi);
  const health = useHealth();
  const [provider, setProvider] = useState<P>("openai");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [out, setOut] = useState<{ text: string; model: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const h = health.get(provider);
  const ready = h.status === "connected";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) { setErr("Prompt is required."); return; }
    setBusy(true); setErr(""); setOut(null); setCopied(false); setDrafted(false);
    try {
      const r = await gen({ data: { provider, model: model || undefined, prompt } });
      if (r.ok) { setOut(r.value); update(() => ({}), `AI generation via ${provider === "openai" ? "OpenAI" : "xAI"} (${r.value.model})`, "info"); }
      else setErr(r.error);
    } catch (e) { setErr(e instanceof Error ? e.message : "Request failed."); }
    finally { setBusy(false); }
  }

  function useAsDraft() {
    if (!out) return;
    const lines = out.text.split("\n").map((l) => l.trim()).filter(Boolean);
    const title = lines[0]?.slice(0, 120) || out.text.slice(0, 120);
    const body = out.text;
    onDraft?.(title, body);
    setDrafted(true);
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
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="label-hud">{out.model}</span>
            <div className="flex gap-1">
              {onDraft && (
                <button type="button" className="btn btn-primary !py-0.5 text-xs" disabled={drafted} onClick={useAsDraft}>
                  {drafted ? <><Check size={12} /> Added</> : "Use as draft"}
                </button>
              )}
              <button type="button" className="btn btn-ghost !py-0.5 text-xs" onClick={() => navigator.clipboard.writeText(out.text).then(() => setCopied(true))}><Copy size={12} />{copied ? "Copied" : "Copy"}</button>
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm">{out.text}</p>
        </div>
      )}
    </Panel>
  );
}
