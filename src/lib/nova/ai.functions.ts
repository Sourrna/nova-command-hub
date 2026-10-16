import { createServerFn } from "@tanstack/react-start";
import { generateInput, generateText, PROVIDERS } from "./ai.server";



export const generateAi = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const r = generateInput.safeParse(d);
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Invalid input");
    return r.data;
  })
  .handler(async ({ data }) => generateText(data, process.env[PROVIDERS[data.provider].env]));
