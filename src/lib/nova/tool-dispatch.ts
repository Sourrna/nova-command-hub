import { z } from "zod";
import { getRepoSnapshot } from "./github.functions";
import { notionSearch } from "./notion.server";
import { linkedinOrganizations } from "./linkedin.server";
import { generateAi } from "./ai.functions";

export type DispatchOp = "github.read.repo" | "notion.search" | "linkedin.read.orgs" | "ai.draft";

export interface DispatchRequest {
  op: DispatchOp;
  args: unknown;
}

export interface DispatchResult {
  ok: boolean;
  op: DispatchOp;
  summary: string;
  data?: unknown;
  error?: string;
  code?: string;
}

const RepoRead = z.object({});
const NotionSearch = z.object({ query: z.string().trim().min(1).max(200) });
const LinkedInOrgs = z.object({});
const AiDraft = z.object({ prompt: z.string().trim().min(1).max(8000), provider: z.enum(["openai", "xai"]).optional() });

const schemas: Record<DispatchOp, z.ZodTypeAny> = {
  "github.read.repo": RepoRead,
  "notion.search": NotionSearch,
  "linkedin.read.orgs": LinkedInOrgs,
  "ai.draft": AiDraft,
};

export function validateDispatch(req: DispatchRequest): { ok: true; data: unknown } | { ok: false; error: string } {
  const s = schemas[req.op];
  if (!s) return { ok: false, error: `Unsupported operation: ${req.op}` };
  const r = s.safeParse(req.args);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "Invalid arguments" };
  return { ok: true, data: r.data };
}

/** Dispatch to existing, implemented services. No arbitrary URLs/shell/APIs.
 *  Writes are not dispatched here — protected operations must go through
 * the approval-gated server functions. */
export async function dispatchTool(req: DispatchRequest, fetchImpl: typeof fetch = fetch): Promise<DispatchResult> {
  const v = validateDispatch(req);
  if (!v.ok) return { ok: false, op: req.op, summary: "Invalid arguments", error: v.error, code: "bad_args" };

  if (req.op === "github.read.repo") {
    try {
      const res = await getRepoSnapshot();
      if (!res.ok) return { ok: false, op: req.op, summary: "GitHub unavailable", error: res.error ?? "GitHub unavailable", code: res.code ?? "error" };
      return { ok: true, op: req.op, summary: `${res.repo}: ${res.info?.stars ?? 0} ★, ${res.info?.openIssues ?? 0} open issues`, data: res };
    } catch (e) {
      return { ok: false, op: req.op, summary: "GitHub dispatch failed", error: e instanceof Error ? e.message : "unknown", code: "error" };
    }
  }

  if (req.op === "notion.search") {
    const args = v.data as { query: string };
    try {
      const res = await notionSearch(args.query, fetchImpl);
      if (!res.ok) return { ok: false, op: req.op, summary: "Notion unavailable", error: res.error, code: res.code };
      const count = Array.isArray((res.data as any)?.results) ? (res.data as any).results.length : 0;
      return { ok: true, op: req.op, summary: `Notion search returned ${count} results`, data: res.data };
    } catch (e) {
      return { ok: false, op: req.op, summary: "Notion dispatch failed", error: e instanceof Error ? e.message : "unknown" };
    }
  }

  if (req.op === "linkedin.read.orgs") {
    try {
      const res = await linkedinOrganizations(fetchImpl);
      if (!res.ok) return { ok: false, op: req.op, summary: "LinkedIn unavailable", error: res.error, code: res.code };
      const count = Array.isArray((res.data as any)?.elements) ? (res.data as any).elements.length : 0;
      return { ok: true, op: req.op, summary: `LinkedIn: ${count} organization(s) accessible`, data: res.data };
    } catch (e) {
      return { ok: false, op: req.op, summary: "LinkedIn dispatch failed", error: e instanceof Error ? e.message : "unknown" };
    }
  }

  if (req.op === "ai.draft") {
    const args = v.data as { prompt: string; provider?: "openai" | "xai" };
    try {
      // useServerFn is not available here; call the server fn handler logic via generateText path would require env.
      // We use the existing server fn shape is not directly callable in-node; instead report honest limitation.
      // The route uses useServerFn(generateAi) which is correct in browser; in tests we inject.
      return { ok: false, op: req.op, summary: "AI draft requires browser/server-fn context", error: "Use the command route to generate drafts with connected providers." };
    } catch (e) {
      return { ok: false, op: req.op, summary: "AI dispatch failed", error: e instanceof Error ? e.message : "unknown" };
    }
  }

  return { ok: false, op: req.op, summary: "Unsupported operation", error: `Unsupported operation: ${req.op}` };
}
