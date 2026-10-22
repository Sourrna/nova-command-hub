import { GH_REPO_DEFAULT, splitRepo, type GitHubOp } from "./github-capabilities";

export interface GitHubCommandRead {
  op: Extract<GitHubOp, "repo.get" | "branches.list" | "issues.list" | "issues.get" | "prs.list" | "prs.get" | "commits.list">;
  owner: string;
  repo: string;
  number?: number;
}

export function resolveGitHubCommandRead(goal: string): GitHubCommandRead {
  const normalized = goal.toLowerCase();
  const repo = splitRepo(goal.match(/(?<![\w.-])([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+)(?![\w.-])/)?.[0] ?? GH_REPO_DEFAULT);
  const pullRequest = /\b(pull requests?|prs?)\b/.test(normalized);
  const issue = /\bissues?\b/.test(normalized);
  const numberMatch = pullRequest
    ? normalized.match(/\b(?:pull request|pr)\s*#?\s*(\d+)\b/)
    : issue
      ? normalized.match(/\bissue\s*#?\s*(\d+)\b/)
      : null;
  const number = numberMatch?.[1] ? Number(numberMatch[1]) : undefined;

  let op: GitHubCommandRead["op"];
  if (pullRequest) op = number ? "prs.get" : "prs.list";
  else if (issue) op = number ? "issues.get" : "issues.list";
  else if (/\bbranches?\b/.test(normalized)) op = "branches.list";
  else if (/\bcommits?\b/.test(normalized)) op = "commits.list";
  else op = "repo.get";

  return {
    op,
    owner: repo.owner,
    repo: repo.repo,
    ...(number === undefined ? {} : { number }),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function normalizeGitHubCommandReadData(op: GitHubCommandRead["op"], data: unknown): unknown {
  if (op !== "issues.list" || !Array.isArray(data)) return data;
  return data.filter((item) => {
    const record = asRecord(item);
    return record !== null && !("pull_request" in record);
  });
}

export function summarizeGitHubCommandRead(op: GitHubCommandRead["op"], data: unknown): string {
  const record = asRecord(data);
  if (op === "issues.list" || op === "prs.list" || op === "branches.list" || op === "commits.list") {
    const items = Array.isArray(data) ? data : [];
    const label = op === "issues.list"
      ? "open issue(s)"
      : op === "prs.list"
        ? "open pull request(s)"
        : op === "branches.list"
          ? "branch(es)"
          : "recent commit(s)";
    const details = items.slice(0, 5).map((item) => {
      const itemRecord = asRecord(item);
      if (!itemRecord) return undefined;
      if (op === "issues.list" || op === "prs.list") {
        const number = typeof itemRecord["number"] === "number" ? `#${itemRecord["number"]} ` : "";
        return `${number}${text(itemRecord["title"]) ?? "Untitled"}`;
      }
      if (op === "branches.list") return text(itemRecord["name"]);
      const commit = asRecord(itemRecord["commit"]);
      const sha = text(itemRecord["sha"])?.slice(0, 7);
      return [sha, text(commit?.["message"])?.split("\n")[0]].filter(Boolean).join(" ");
    }).filter((item): item is string => Boolean(item));
    const countText = `GitHub returned ${items.length} ${label}`;
    if (items.length === 0) return `${countText}.`;
    const remaining = items.length > details.length ? `; and ${items.length - details.length} more` : "";
    return `${countText}: ${details.join("; ")}${remaining}.`;
  }
  if (op === "issues.get" || op === "prs.get") {
    const kind = op === "issues.get" ? "Issue" : "Pull request";
    const number = typeof record?.["number"] === "number" ? ` #${record["number"]}` : "";
    const title = text(record?.["title"]);
    const state = text(record?.["state"]);
    return `${kind}${number}${title ? `: ${title}` : ""}${state ? ` (${state})` : ""}.`;
  }
  if (op === "repo.get") {
    return text(record?.["full_name"]) ?? text(record?.["name"]) ?? "GitHub repository details retrieved.";
  }
  return "GitHub operation completed.";
}
