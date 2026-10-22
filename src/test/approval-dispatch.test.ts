import { describe, expect, it, vi } from "vitest";
import { approvalHandlerFor, dispatchApproval } from "@/lib/nova/approval-dispatch";

describe("approval operation dispatch", () => {
  it("never routes a GitHub operation through the Notion adapter", async () => {
    const notion = vi.fn(async () => "notion");
    const linkedin = vi.fn(async () => "linkedin");
    expect(approvalHandlerFor("github", "write")).toBeNull();
    await expect(dispatchApproval("github", "write", { "notion-write": notion, "linkedin-publish": linkedin }))
      .rejects.toThrow(/Unsupported approval operation/);
    expect(notion).not.toHaveBeenCalled();
    expect(linkedin).not.toHaveBeenCalled();
  });

  it("dispatches only the exact implemented connector/action pairs", async () => {
    const notion = vi.fn(async () => "notion");
    const linkedin = vi.fn(async () => "linkedin");
    expect(await dispatchApproval("notion", "write", { "notion-write": notion, "linkedin-publish": linkedin })).toBe("notion");
    expect(await dispatchApproval("linkedin", "publish", { "notion-write": notion, "linkedin-publish": linkedin })).toBe("linkedin");
    expect(approvalHandlerFor("notion", "publish")).toBeNull();
    expect(approvalHandlerFor("linkedin", "write")).toBeNull();
    expect(notion).toHaveBeenCalledTimes(1);
    expect(linkedin).toHaveBeenCalledTimes(1);
  });
});
