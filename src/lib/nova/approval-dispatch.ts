export type ApprovalHandler = "notion-write" | "linkedin-publish";

export function approvalHandlerFor(connector: string, operation: string | undefined): ApprovalHandler | null {
  if (connector === "notion" && operation === "write") return "notion-write";
  if (connector === "linkedin" && operation === "publish") return "linkedin-publish";
  return null;
}

export async function dispatchApproval<T>(
  connector: string,
  operation: string | undefined,
  handlers: Partial<Record<ApprovalHandler, () => Promise<T>>>,
): Promise<T> {
  const handler = approvalHandlerFor(connector, operation);
  if (!handler || !handlers[handler]) {
    throw new Error(`Unsupported approval operation: ${connector}/${operation ?? "unspecified"}. No external action was run.`);
  }
  return handlers[handler]!();
}
