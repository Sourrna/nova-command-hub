import { getRequest } from "@tanstack/react-start/server";
import { notionCredentials } from "./notion.server";

// Nitro 3 cloudflare-module augments the original Request before TanStack receives it.
export function getNotionCredentials() {
  const request = getRequest() as Request & { runtime?: { cloudflare?: { env?: Record<string, unknown> } } };
  const bindings = request.runtime?.cloudflare?.env;
  // An existing Worker binding bag is authoritative, even when a secret is absent.
  if (bindings) return notionCredentials(bindings);
  // Vite's Node dev server has no Worker bindings. Never use this fallback in production.
  if (import.meta.env.DEV) return notionCredentials(process.env);
  return notionCredentials({});
}