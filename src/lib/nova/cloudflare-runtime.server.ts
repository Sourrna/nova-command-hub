export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run<T = unknown>(): Promise<{ success: boolean; results?: T[]; meta?: { changes?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface NovaCloudflareEnv {
  NOVA_DB?: D1Database;
  CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
  CLOUDFLARE_ACCESS_AUD?: string;
}

const requestEnvironments = new WeakMap<Request, NovaCloudflareEnv>();

export function registerRequestEnvironment(request: Request, env: unknown): () => void {
  const bindings = env && typeof env === "object" ? env as NovaCloudflareEnv : {};
  requestEnvironments.set(request, bindings);
  return () => requestEnvironments.delete(request);
}

export function getRequestEnvironment(request: Request): NovaCloudflareEnv {
  return requestEnvironments.get(request) ?? {};
}
