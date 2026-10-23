import { useCallback, useEffect, useRef, useState } from "react";
import { getDurableWorkspace, saveDurableWorkspace, WorkspaceDocumentSchema, type WorkspaceDocument } from "./workspace.functions";
import { replaceWorkspaceState, useNova, type NovaState } from "./store";

export type WorkspacePersistenceStatus = "loading" | "synced" | "local-only" | "error";

interface WorkspacePersistence {
  status: WorkspacePersistenceStatus;
  message: string;
  retry: () => void;
}

const LOCAL_KEY = "nova-brand-os-v1";

function hasSavedLocalWorkspace(): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(LOCAL_KEY) !== null;
}

function mergeLocalOnlyRecords(remote: WorkspaceDocument, local: NovaState): WorkspaceDocument {
  const merge = <T extends { id: string }>(remoteItems: T[], localItems: T[], limit = Infinity): T[] => {
    const known = new Set(remoteItems.map((item) => item.id));
    return [...remoteItems, ...localItems.filter((item) => !known.has(item.id))].slice(0, limit);
  };
  return {
    ...remote,
    disabled: [...new Set([...remote.disabled, ...local.disabled])],
    tasks: merge(remote.tasks, local.tasks),
    content: merge(remote.content, local.content),
    projects: merge(remote.projects, local.projects),
    memory: merge(remote.memory, local.memory),
    log: merge(remote.log, local.log, 300),
    approvals: merge(remote.approvals, local.approvals),
    executions: merge(remote.executions, local.executions, 30),
  };
}

function toState(document: WorkspaceDocument): NovaState {
  return document;
}

function toDocumentJson(document: WorkspaceDocument): string {
  return JSON.stringify(document);
}

function localOnlyMessage(code: string): string {
  if (code === "authentication_required") return "Local-only: configure Cloudflare Access and sign in to enable owner-scoped sync.";
  if (code === "database_unavailable") return "Local-only: the NOVA_DB D1 binding is not configured.";
  return "Local-only: durable workspace storage is unavailable. Changes remain in this browser.";
}

export function useWorkspacePersistence(): WorkspacePersistence {
  const state = useNova((value) => value);
  const [status, setStatus] = useState<WorkspacePersistenceStatus>("loading");
  const [message, setMessage] = useState("Checking durable workspace storage…");
  const [attempt, setAttempt] = useState(0);
  const revision = useRef<number | null>(null);
  const latestDocument = useRef<WorkspaceDocument>(state);
  const persistedJson = useRef<string | null>(null);
  const inFlight = useRef(false);
  const ready = useRef(false);
  const failed = useRef(false);

  latestDocument.current = state;

  const retry = useCallback(() => {
    failed.current = false;
    revision.current = null;
    ready.current = false;
    setStatus("loading");
    setMessage("Checking durable workspace storage…");
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      const localWasSaved = hasSavedLocalWorkspace();
      try {
        const remote = await getDurableWorkspace();
        if (!active) return;
        if (!remote.ok) {
          if (remote.code === "authentication_required" || remote.code === "database_unavailable") {
            setStatus("local-only");
            setMessage(localOnlyMessage(remote.code));
          } else {
            setStatus("error");
            setMessage(remote.error);
          }
          failed.current = true;
          return;
        }

        if (!remote.exists) {
          const initial = latestDocument.current;
          const saved = await saveDurableWorkspace({ data: { expectedRevision: 0, documentJson: toDocumentJson(initial) } });
          if (!active) return;
          if (!saved.ok) {
            setStatus("local-only");
            setMessage(saved.error);
            failed.current = true;
            return;
          }
          revision.current = saved.revision;
          persistedJson.current = JSON.stringify(initial);
        } else {
          const local = latestDocument.current;
          let parsedRemote: unknown;
          try {
            parsedRemote = JSON.parse(remote.documentJson);
          } catch {
            setStatus("error");
            setMessage("Stored workspace data is invalid JSON; local data was preserved.");
            failed.current = true;
            return;
          }
          const validatedRemote = WorkspaceDocumentSchema.safeParse(parsedRemote);
          if (!validatedRemote.success) {
            setStatus("error");
            setMessage("Stored workspace data failed validation; local data was preserved.");
            failed.current = true;
            return;
          }
          const merged = localWasSaved ? mergeLocalOnlyRecords(validatedRemote.data, local) : validatedRemote.data;
          replaceWorkspaceState(toState(merged));
          revision.current = remote.revision;
          if (JSON.stringify(merged) !== JSON.stringify(validatedRemote.data)) {
            const saved = await saveDurableWorkspace({
              data: { expectedRevision: remote.revision, documentJson: toDocumentJson(merged) },
            });
            if (!active) return;
            if (!saved.ok) {
              setStatus("error");
              setMessage(saved.error);
              failed.current = true;
              return;
            }
            revision.current = saved.revision;
          }
          persistedJson.current = JSON.stringify(merged);
        }
        if (active) {
          ready.current = true;
          setStatus("synced");
          setMessage("Workspace synced to your authenticated account.");
        }
      } catch {
        if (!active) return;
        setStatus("local-only");
        setMessage("Local-only: the durable workspace request failed. Changes remain in this browser.");
        failed.current = true;
      }
    };
    void initialize();
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (!ready.current || failed.current || revision.current === null || persistedJson.current === JSON.stringify(state)) return;
    const timer = window.setTimeout(() => {
      if (inFlight.current || failed.current || revision.current === null) return;
      inFlight.current = true;
      void (async () => {
        try {
          while (!failed.current && revision.current !== null) {
            const document = latestDocument.current;
            const serialized = JSON.stringify(document);
            if (serialized === persistedJson.current) break;
            const result = await saveDurableWorkspace({
              data: { expectedRevision: revision.current, documentJson: toDocumentJson(document) },
            });
            if (!result.ok) {
              failed.current = true;
              setStatus(result.code === "conflict" ? "error" : "local-only");
              setMessage(result.error);
              break;
            }
            revision.current = result.revision;
            persistedJson.current = serialized;
          }
          if (!failed.current) setStatus("synced");
        } catch {
          failed.current = true;
          setStatus("local-only");
          setMessage("Local-only: saving the workspace failed. Changes remain in this browser.");
        } finally {
          inFlight.current = false;
        }
      })();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [state, status]);

  return { status, message, retry };
}
