import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText, PROVIDERS } from "./ai.server";
import { buildInterpretationPrompt, parseInterpretation } from "./command-interpreter";

const input = z.object({
  goal: z.string().trim().min(1, "Goal is required").max(8000),
  provider: z.enum(["openai", "xai"]).optional(),
});

export const interpretGoal = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const r = input.safeParse(d);
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Invalid input");
    return r.data;
  })
  .handler(async ({ data }) => {
    const provider = data.provider ?? "openai";
    const key = process.env[PROVIDERS[provider].env];
    if (!key) return { ok: false as const, code: "missing_key" as const, error: `Missing ${PROVIDERS[provider].env}` };
    const prompt = buildInterpretationPrompt(data.goal);
    const res = await generateText({ provider, prompt }, key);
    if (!res.ok) return { ok: false as const, code: res.code, error: res.error };
    const parsed = parseInterpretation(res.value.text);
    if (!parsed.ok) return { ok: false as const, code: "provider" as const, error: parsed.error };
    return { ok: true as const, value: parsed.value, model: res.value.model };
  });
