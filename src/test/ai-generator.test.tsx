// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { AiGenerator } from "@/components/nova/AiGenerator";

// Mock the server fn and health so the component renders without a server.
// vi.mock factories are hoisted, so no top-level variables may be referenced
// inside them — the store is left real because update() is safe in jsdom.
vi.mock("@/lib/nova/ai.functions", () => ({
  generateAi: Symbol("generateAi"),
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => (async (args: { data: { prompt: string } }) => ({
    ok: true as const,
    value: { text: "Hook\nBody line one\nBody line two", model: "mock" },
  })),
}));

vi.mock("@/lib/nova/health", () => ({
  useHealth: () => ({
    get: () => ({ status: "connected", reason: "ok", missing: [] }),
    isLoading: false,
    data: [],
  }),
}));

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("AiGenerator — use-as-draft workflow", () => {
  it("invokes onDraft with the first line as title and full text as body", async () => {
    const onDraft = vi.fn();
    renderWithClient(<AiGenerator onDraft={onDraft} />);

    fireEvent.change(screen.getByPlaceholderText(/describe what to draft/i), {
      target: { value: "Write a launch post" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    await waitFor(() => screen.getByRole("button", { name: /use as draft/i }));

    fireEvent.click(screen.getByRole("button", { name: /use as draft/i }));

    expect(onDraft).toHaveBeenCalledTimes(1);
    expect(onDraft).toHaveBeenCalledWith("Hook", "Hook\nBody line one\nBody line two");
  });

  it("marks the draft as added and disables the button after use", async () => {
    const onDraft = vi.fn();
    renderWithClient(<AiGenerator onDraft={onDraft} />);

    fireEvent.change(screen.getByPlaceholderText(/describe what to draft/i), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => screen.getByRole("button", { name: /use as draft/i }));

    const btn = screen.getByRole("button", { name: /use as draft/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(await screen.findByRole("button", { name: /added/i })).toBeDisabled();
  });

  it("does not call onDraft when no output is generated", () => {
    const onDraft = vi.fn();
    renderWithClient(<AiGenerator onDraft={onDraft} />);
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("still copies text to clipboard when no onDraft is provided", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWithClient(<AiGenerator />);

    fireEvent.change(screen.getByPlaceholderText(/describe what to draft/i), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => screen.getByRole("button", { name: /copy/i }));
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith("Hook\nBody line one\nBody line two");
  });
});