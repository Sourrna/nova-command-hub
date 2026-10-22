import { z } from "zod";

export const GoalInterpretationSchema = z.object({
  objective: z.string().trim().min(1).max(280),
  intent: z.enum(["draft", "publish", "research", "save", "plan"]),
  connectors: z.array(z.string().trim().min(1)).max(6).default([]),
  steps: z.array(z.object({
    title: z.string().trim().min(1).max(120),
    kind: z.enum(["generate", "read", "write", "publish", "approve"]),
    connector: z.string().trim().min(1).max(32),
    gated: z.boolean().default(false),
  })).min(1).max(8),
  needsApproval: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
});
export type GoalInterpretation = z.infer<typeof GoalInterpretationSchema>;

const SYSTEM = "You are Nova's command planner. Return ONLY valid JSON matching this schema. Do not explain, do not add markdown fences.\n{\n  \"objective\": string,\n  \"intent\": \"draft\"|\"publish\"|\"research\"|\"save\"|\"plan\",\n  \"connectors\": string[],\n  \"steps\": [{\"title\": string, \"kind\": \"generate\"|\"read\"|\"write\"|\"publish\"|\"approve\", \"connector\": string, \"gated\": boolean}],\n  \"needsApproval\": boolean,\n  \"confidence\": number\n}";

export function buildInterpretationPrompt(goal: string): string {
  return `${SYSTEM}\n\nGoal: ${goal.trim().slice(0, 8000)}`;
}

export function parseInterpretation(text: string): { ok: true; value: GoalInterpretation } | { ok: false; error: string } {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(cleaned);
    const r = GoalInterpretationSchema.safeParse(parsed);
    if (!r.success) return { ok: false, error: "AI response failed schema validation." };
    return { ok: true, value: r.data };
  } catch {
    return { ok: false, error: "AI response was not valid JSON." };
  }
}
