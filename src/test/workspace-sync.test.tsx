import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const serverFns = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/lib/nova/workspace.functions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nova/workspace.functions")>("@/lib/nova/workspace.functions");
  return {
    ...actual,
    getDurableWorkspace: serverFns.get,
    saveDurableWorkspace: serverFns.save,
  };
});

import { useWorkspacePersistence } from "@/lib/nova/workspace-sync";
import { actions, readState } from "@/lib/nova/store";

function PersistenceStatus() {
  const persistence = useWorkspacePersistence();
  return <div><span>{persistence.status}</span><span>{persistence.message}</span></div>;
}

describe("workspace persistence state", () => {
  beforeEach(() => {
    localStorage.clear();
    actions.reset();
    serverFns.get.mockReset();
    serverFns.save.mockReset();
  });

  it("migrates the local workspace on first durable load and reports synced only after save", async () => {
    serverFns.get.mockResolvedValue({ ok: true, exists: false, revision: 0 });
    serverFns.save.mockResolvedValue({ ok: true, revision: 1 });
    render(<PersistenceStatus />);

    await waitFor(() => expect(screen.getByText("synced")).toBeInTheDocument());
    expect(serverFns.save).toHaveBeenCalledWith({
      data: { expectedRevision: 0, documentJson: JSON.stringify(readState()) },
    });
  });

  it("reports local-only mode when the database binding is unavailable", async () => {
    serverFns.get.mockResolvedValue({
      ok: false, code: "database_unavailable", error: "Durable workspace storage is not configured.",
    });
    render(<PersistenceStatus />);

    await waitFor(() => expect(screen.getByText("local-only")).toBeInTheDocument());
    expect(screen.getByText(/NOVA_DB D1 binding is not configured/)).toBeInTheDocument();
    expect(serverFns.save).not.toHaveBeenCalled();
  });

  it("hydrates an existing durable document and persists later workspace changes", async () => {
    serverFns.get.mockResolvedValue({
      ok: true, exists: true, revision: 4, documentJson: JSON.stringify(readState()),
    });
    serverFns.save.mockResolvedValue({ ok: true, revision: 5 });
    render(<PersistenceStatus />);

    await waitFor(() => expect(screen.getByText("synced")).toBeInTheDocument());
    actions.addTask("Durable sync regression task");
    await waitFor(() => expect(serverFns.save).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(serverFns.save.mock.calls[0]?.[0]).toMatchObject({
      data: { expectedRevision: 4 },
    });
    const saved = JSON.parse(serverFns.save.mock.calls[0]?.[0].data.documentJson as string) as ReturnType<typeof readState>;
    expect(saved.tasks.some((task) => task.title === "Durable sync regression task")).toBe(true);
  });

  it("keeps local data when durable storage contains an invalid document", async () => {
    serverFns.get.mockResolvedValue({
      ok: true, exists: true, revision: 3, documentJson: "{not-json",
    });
    render(<PersistenceStatus />);

    await waitFor(() => expect(screen.getByText("error")).toBeInTheDocument());
    expect(screen.getByText(/local data was preserved/)).toBeInTheDocument();
    expect(serverFns.save).not.toHaveBeenCalled();
  });
});
