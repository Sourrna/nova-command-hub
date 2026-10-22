import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ghGet } from "./github.server";
import { githubCaps, githubArgsSchema, type GitHubOp } from "./github-capabilities";

const input = z.object({
  op: z.enum(["repo.get","branches.list","issues.list","issues.get","prs.list","prs.get","commits.list"]),
  owner: z.string().trim().min(1).max(39),
  repo: z.string().trim().min(1).max(100),
  number: z.coerce.number().int().positive().optional(),
});

export const githubRead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const r = input.safeParse(d);
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Invalid input");
    return r.data;
  })
  .handler(async ({ data }) => {
    const op = data.op as GitHubOp;
    const cap = githubCaps[op];
    if (!cap) return { ok: false as const, error: "Unsupported operation" };
    const schema = githubArgsSchema[op];
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid arguments" };
    const path = cap.path(parsed.data);
    const res = await ghGet<any>(path);
    if (!res.ok) return { ok: false as const, code: res.code, error: res.error };
    return { ok: true as const, data: res.data };
  });
