import { z } from "zod";

export type GitHubOp =
  | "repo.get"
  | "branches.list"
  | "issues.list"
  | "issues.get"
  | "prs.list"
  | "prs.get"
  | "commits.list"
  | "issues.create"
  | "branches.create"
  | "prs.create";

export type AuthzClass = "read" | "write" | "destructive";

export interface GitHubCapability {
  op: GitHubOp;
  method: "GET" | "POST";
  path: (args: any) => string;
  authz: AuthzClass;
  implemented: boolean;
  requires: { token?: boolean; scopes?: string[] };
  approvalRequired: boolean;
  description: string;
  notes: string;
}

export const GH_REPO_DEFAULT = "Sourrna/nova-brand-ai";

export const githubCaps: Record<GitHubOp, GitHubCapability> = {
  "repo.get": {
    op: "repo.get",
    method: "GET",
    path: ({ owner, repo }) => `repos/${owner}/${repo}`,
    authz: "read",
    implemented: true,
    requires: { token: false },
    approvalRequired: false,
    description: "Repository metadata",
    notes: "Works unauthenticated for public repos (lower rate limits).",
  },
  "branches.list": {
    op: "branches.list",
    method: "GET",
    path: ({ owner, repo }) => `repos/${owner}/${repo}/branches?per_page=30`,
    authz: "read",
    implemented: true,
    requires: { token: false },
    approvalRequired: false,
    description: "List branches",
    notes: "Paginated by per_page.",
  },
  "issues.list": {
    op: "issues.list",
    method: "GET",
    path: ({ owner, repo }) => `repos/${owner}/${repo}/issues?state=${encodeURIComponent("open")}&per_page=30`,
    authz: "read",
    implemented: true,
    requires: { token: false },
    approvalRequired: false,
    description: "List open issues",
    notes: "Excludes pull requests (GitHub API quirk).",
  },
  "issues.get": {
    op: "issues.get",
    method: "GET",
    path: ({ owner, repo, number }) => `repos/${owner}/${repo}/issues/${number}`,
    authz: "read",
    implemented: true,
    requires: { token: false },
    approvalRequired: false,
    description: "Get issue details",
    notes: "Validates issue number.",
  },
  "prs.list": {
    op: "prs.list",
    method: "GET",
    path: ({ owner, repo }) => `repos/${owner}/${repo}/pulls?state=${encodeURIComponent("open")}&per_page=30`,
    authz: "read",
    implemented: true,
    requires: { token: false },
    approvalRequired: false,
    description: "List open pull requests",
    notes: "",
  },
  "prs.get": {
    op: "prs.get",
    method: "GET",
    path: ({ owner, repo, number }) => `repos/${owner}/${repo}/pulls/${number}`,
    authz: "read",
    implemented: true,
    requires: { token: false },
    approvalRequired: false,
    description: "Get pull request details",
    notes: "",
  },
  "commits.list": {
    op: "commits.list",
    method: "GET",
    path: ({ owner, repo }) => `repos/${owner}/${repo}/commits?per_page=30`,
    authz: "read",
    implemented: true,
    requires: { token: false },
    approvalRequired: false,
    description: "List recent commits",
    notes: "",
  },
  "issues.create": {
    op: "issues.create",
    method: "POST",
    path: ({ owner, repo }) => `repos/${owner}/${repo}/issues`,
    authz: "write",
    implemented: false,
    requires: { token: true, scopes: ["repo"] },
    approvalRequired: true,
    description: "Create an issue",
    notes: "Requires write access. Bound to approval payload.",
  },
  "branches.create": {
    op: "branches.create",
    method: "POST",
    path: ({ owner, repo }) => `repos/${owner}/${repo}/git/refs`,
    authz: "write",
    implemented: false,
    requires: { token: true, scopes: ["repo"] },
    approvalRequired: true,
    description: "Create a branch (ref)",
    notes: "Requires existing sha of base branch.",
  },
  "prs.create": {
    op: "prs.create",
    method: "POST",
    path: ({ owner, repo }) => `repos/${owner}/${repo}/pulls`,
    authz: "write",
    implemented: false,
    requires: { token: true, scopes: ["repo"] },
    approvalRequired: true,
    description: "Create a pull request",
    notes: "Requires head/base branches and write access.",
  },
};

const ownerSlug = z.string().trim().min(1).max(39).regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);
const repositorySlug = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/).refine((value) => value !== "." && value !== "..");
const repoId = z.object({ owner: ownerSlug, repo: repositorySlug });
const numberId = repoId.extend({ number: z.coerce.number().int().positive() });

export const githubArgsSchema: Record<GitHubOp, z.ZodTypeAny> = {
  "repo.get": repoId,
  "branches.list": repoId,
  "issues.list": repoId,
  "issues.get": numberId,
  "prs.list": repoId,
  "prs.get": numberId,
  "commits.list": repoId,
  "issues.create": repoId.extend({ title: z.string().trim().min(1).max(256), body: z.string().trim().max(65536).optional() }),
  "branches.create": repoId.extend({ ref: z.string().trim().min(1).max(100), sha: z.string().trim().min(7).max(40) }),
  "prs.create": repoId.extend({ title: z.string().trim().min(1).max(256), head: z.string().trim().min(1), base: z.string().trim().min(1), body: z.string().trim().max(65536).optional() }),
};

export function splitRepo(full: string): { owner: string; repo: string } {
  const p = full.split("/");
  return { owner: p[0] || "Sourrna", repo: p[1] || "nova-brand-ai" };
}
