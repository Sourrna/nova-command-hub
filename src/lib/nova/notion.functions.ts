import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const searchNotionInput = z.object({ query: z.string().trim().max(200).optional(), cursor: z.string().max(500).optional() });
export const listNotion = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => searchNotionInput.parse(input))
  .handler(async ({ data }) => {
    const [{ searchNotion }, { getNotionCredentials }, { setResponseHeader }] = await Promise.all([
      import("./notion.server"), import("./notion-runtime.server"), import("@tanstack/react-start/server"),
    ]);
    setResponseHeader("Cache-Control", "private, no-store");
    return searchNotion(getNotionCredentials(), data);
  });