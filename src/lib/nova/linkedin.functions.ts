import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { linkedinOrganizations, linkedinMetrics, linkedinPosts, linkedinPublishPost, type LinkedinPostInput } from "./linkedin.server";
import { consumeApproval, grantApproval } from "./approval.server";

export interface LinkedinSnapshot {
  ok: boolean;
  error?: string;
  code?: "missing" | "auth" | "rate" | "error";
  organizations: number;
  posts: number;
  engagement: number;
  firstOrgId?: string | undefined;
}

type Org = { id?: string };

function elements(r: { data?: { elements?: unknown[] } } | { ok: false; code: string; error: string }): unknown[] {
  if (!r || !("data" in r) || !r.data) return [];
  return Array.isArray(r.data.elements) ? r.data.elements : [];
}

/** Pure core — no Start runtime dependency, safe to unit-test directly. */
export function buildLinkedinSnapshot(
  orgs: Awaited<ReturnType<typeof linkedinOrganizations>>,
  posts: Awaited<ReturnType<typeof linkedinPosts>>,
  metrics: Awaited<ReturnType<typeof linkedinMetrics>>,
): LinkedinSnapshot {
  if (!orgs.ok) return { ok: false, error: orgs.error, code: orgs.code, organizations: 0, posts: 0, engagement: 0 };
  const orgElements = elements(orgs) as Org[];
  return {
    ok: true,
    organizations: orgElements.length,
    posts: elements(posts).length,
    engagement: elements(metrics).length,
    firstOrgId: orgElements[0]?.id,
  };
}

export const getLinkedinSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<LinkedinSnapshot> => {
    const orgs = await linkedinOrganizations();
    if (!orgs.ok) return buildLinkedinSnapshot(orgs, { ok: false, code: orgs.code, error: orgs.error } as never, { ok: false, code: orgs.code, error: orgs.error } as never);
    const rawElements = (orgs.data as { elements?: Org[] } | undefined)?.elements;
    const orgElements = Array.isArray(rawElements) ? rawElements : [];
    const firstId = orgElements[0]?.id ?? "";
    const [posts, metrics] = await Promise.all([
      firstId ? linkedinPosts(firstId) : Promise.resolve({ ok: false as const, code: "error" as const, error: "No organization id." }),
      firstId ? linkedinMetrics(firstId) : Promise.resolve({ ok: false as const, code: "error" as const, error: "No organization id." }),
    ]);
    return buildLinkedinSnapshot(orgs, posts as Awaited<ReturnType<typeof linkedinPosts>>, metrics as Awaited<ReturnType<typeof linkedinMetrics>>);
  },
);

/** Server fn: create a server-side grant for a LinkedIn publish. Called by
 * the HUMAN's Approve click — never by the write executor and never from a
 * client-controlled flag. The grant locks the content item, the exact payload,
 * the author URN (destination), and the action string. */
export const grantLinkedinApproval = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const s = z.object({
      approvalId: z.string().trim().min(1, "Approval id is required"),
      contentId: z.string().trim().min(1, "Content id is required"),
      author: z.string().trim().min(1, "Author is required"),
      visibility: z.enum(["PUBLIC", "CONNECTIONS"]),
      commentary: z.string().trim().min(1, "Commentary is required").max(700, "Post is too long (max 700 characters)"),
      title: z.string().trim().max(200).optional(),
    });
    const r = s.safeParse(d);
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Invalid input");
    return r.data;
  })
  .handler(async ({ data }) => {
    grantApproval(
      data.approvalId,
      data.contentId,
      data.title ?? "",
      data.commentary,
      data.author.trim(),
      `Publish to LinkedIn as ${data.author.trim()}`,
    );
    return { ok: true as const };
  });

export const executeLinkedinPublish = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const s = z.object({
      author: z.string().trim().min(1, "Author is required"),
      visibility: z.enum(["PUBLIC", "CONNECTIONS"]),
      commentary: z.string().trim().min(1, "Commentary is required").max(700, "Post is too long (max 700 characters)"),
      title: z.string().trim().max(200).optional(),
      approvalId: z.string().trim().min(1, "Approval id is required"),
      contentId: z.string().trim().min(1, "Content id is required"),
      /** MUST be false. A client-supplied true would let an untrusted caller
       * self-grant a write. Grants are created by the human's Approve click
       * via grantLinkedinApproval, which runs server-side. */
      grant: z.literal(false),
    });
    const r = s.safeParse(d);
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Invalid input");
    return r.data;
  })
  .handler(async ({ data }) =>
    executeLinkedinPublishCore(
      data as { author: string; visibility: "PUBLIC" | "CONNECTIONS"; commentary: string; title?: string; approvalId: string; contentId: string },
      (i, f) => linkedinPublishPost(i, f),
    ),
  );

/** Pure core — no Start runtime dependency, safe to unit-test directly.
 * `publish` is injected so tests can supply a stub adapter. */
export async function executeLinkedinPublishCore(
  data: {
    author: string;
    visibility: "PUBLIC" | "CONNECTIONS";
    commentary: string;
    title?: string;
    approvalId: string;
    contentId: string;
  },
  publish: (input: LinkedinPostInput, f: typeof fetch) => Promise<Awaited<ReturnType<typeof linkedinPublishPost>>>,
  f: typeof fetch = fetch,
): Promise<{ ok: true; postId: string; url?: string | undefined; idempotencyKey: string } | { ok: false; code: string; error: string }> {
  const input: LinkedinPostInput = {
    author: data.author,
    visibility: data.visibility,
    commentary: data.commentary,
    ...(data.title ? { title: data.title } : {}),
  };

  // The grant was created by the human's click (grantLinkedinApproval). We do
  // NOT create one here — a client flag is not authorization. Consume the
  // existing grant atomically: payload hash, ownership, destination (author
  // URN), action, and single-use are all enforced.
  let grant: Awaited<ReturnType<typeof consumeApproval>>;
  try {
    grant = consumeApproval(
      data.approvalId,
      data.contentId,
      data.title ?? "",
      data.commentary,
      data.author.trim(),
      `Publish to LinkedIn as ${data.author.trim()}`,
    );
  } catch (e) {
    return { ok: false as const, code: "error", error: e instanceof Error ? e.message : "Approval not valid." };
  }

  let result: Awaited<ReturnType<typeof linkedinPublishPost>>;
  try {
    result = await publish({ ...input, idempotencyKey: grant.idempotencyKey }, f);
  } catch (e) {
    // The grant is already consumed, so a retry cannot replay this approval.
    return { ok: false as const, code: "error", error: e instanceof Error ? e.message : "LinkedIn publish failed." };
  }

  if (!result.ok) {
    return { ok: false as const, code: result.code, error: result.error };
  }
  return { ok: true as const, postId: result.data.id, url: result.data.url, idempotencyKey: grant.idempotencyKey };
}