import { z } from "zod";

export type LocalAgent = "kilo" | "hermes";

export interface LocalInvokeInput {
  agent: LocalAgent;
  prompt: string;
  timeoutMs?: number;
  cwd?: string;
}

export interface LocalInvokeResult {
  ok: boolean;
  agent: LocalAgent;
  output: string;
  code?: number | null;
  error?: string;
  durationMs: number;
}

const schema = z.object({
  agent: z.enum(["kilo", "hermes"]),
  prompt: z.string().trim().min(1).max(8000),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  cwd: z.string().trim().max(260).optional(),
});

export function validateLocalInvoke(input: unknown): { ok: true; data: z.infer<typeof schema> } | { ok: false; error: string } {
  const r = schema.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "Invalid input" };
  return { ok: true, data: r.data };
}

/** Capability flags discovered from environment inspection. */
export const LOCAL_CAPS = {
  kilo: {
    bin: "c:\\Users\\Asus\\.vscode\\extensions\\kilocode.kilo-code-7.8.12-win32-x64\\bin\\kilo.exe",
    run: true,
    serve: false,
    acp: true,
    notes: "kilo run exists but `kilo serve` errored in probe; ACP available.",
  },
  hermes: {
    bin: "C:\\Users\\Asus\\AppData\\Local\\hermes\\bin\\hermes.exe",
    serve: true,
    mcp_serve: true,
    acp: true,
    notes: "hermes serve started on 127.0.0.1:9119 (JSON-RPC).",
  },
} as const;
