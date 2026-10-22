import { describe, expect, it } from "vitest";
import { normalizeNotionSearchRecord } from "@/lib/nova/notion.functions";

describe("normalizeNotionSearchRecord", () => {
  it("returns serializable database search records and their title", () => {
    expect(normalizeNotionSearchRecord({
      id: "database-1",
      object: "database",
      url: "https://notion.example/database-1",
      title: [{ plain_text: "Engineering Ledger" }],
    })).toEqual({
      id: "database-1",
      object: "database",
      url: "https://notion.example/database-1",
      title: "Engineering Ledger",
    });
  });

  it("extracts page titles from provider properties and ignores malformed records", () => {
    expect(normalizeNotionSearchRecord({
      id: "page-1",
      object: "page",
      properties: { Name: { title: [{ text: { content: "Launch plan" } }] } },
    })).toEqual({ id: "page-1", object: "page", title: "Launch plan" });
    expect(normalizeNotionSearchRecord({ id: "invalid" })).toBeNull();
  });
});
