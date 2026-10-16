// Server-only OpenAI / xAI adapters. Keys are read from process.env by callers and
// never returned, logged, or echoed in errors.
import { z } from "zod";
import { AI_MODELS } from "./ai-models";

export type AiProvider = "openai" | "xai";

export const PROVIDERS: Record<AiProvider, { base: string; env: string; models: string[] }> = {
  openai: { base: "https://api.openai.com/v1", env: "OPENAI_API_KEY", models: [...AI_MODELS.openai] },
  xai: { base: "https://api.x.ai/v1", env: "XAI_API_KEY", models: [...AI_MODELS.xai] },
};

export const generateInput = z.object({
  provider: z.enum(["openai", "xai"]),
  model: z.string().trim().max(64).optional(),
  prompt: z.string().trim().min(1, "Prompt is required").max(8000, "Prompt is too long (max 8000 characters)"),
}).refine((d) => !d.model || PROVIDERS[d.provider].models.includes(d.model), { message: "Unsupported model", path: ["model"] });
export type GenerateInput = z.infer<typeof generateInput>;

export type AiResult<T> = { ok: true; value: T } | { ok: false; code: "missing_key" | "auth" | "rate_limit" | "timeout" | "provider" | "network"; error: string };

type Fetch = typeof fetch;

function sanitize(status: number): AiResult<never> {
  if (status === 401 || status === 403) return { ok: false, code: "auth", error: "Provider rejected the API key (unauthorised)." };
  if (status === 429) return { ok: false, code: "rate_limit", error: "Rate limited or quota exceeded. Try again later." };
  if (status === 400 || status === 404) return { ok: false, code: "provider", error: `Provider rejected the request (HTTP ${status}).` };
  return { ok: false, code: "provider", error: `Provider error (HTTP ${status}).` };
}

async function call(provider: AiProvider, key: string | undefined, path: string, init: RequestInit, timeoutMs: number, f: Fetch): Promise<AiResult<unknown>> {
  if (!key) return { ok: false, code: "missing_key", error: `Missing ${PROVIDERS[provider].env}` };
  try {
    const res = await f(PROVIDERS[provider].base + path, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return sanitize(res.status);
    return { ok: true, value: await res.json() };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, code: "timeout", error: "Provider did not respond in time." };
    return { ok: false, code: "network", error: "Network error reaching provider." };
  }
}

/** Minimal authenticated request (list models). */
export async function testProvider(provider: AiProvider, key: string | undefined, f: Fetch = fetch): Promise<AiResult<null>> {
  const r = await call(provider, key, "/models", { method: "GET" }, 8000, f);
  return r.ok ? { ok: true, value: null } : r;
}

export async function generateText(input: GenerateInput, key: string | undefined, f: Fetch = fetch): Promise<AiResult<{ text: string; model: string }>> {
  const model = input.model || PROVIDERS[input.provider].models[0]!;
  const r = await call(input.provider, key, "/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model, messages: [{ role: "user", content: input.prompt }], max_tokens: 1024 }),
  }, 45000, f);
  if (!r.ok) return r;
  const text = (r.value as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) return { ok: false, code: "provider", error: "Provider returned an empty response." };
  return { ok: true, value: { text, model } };
}
