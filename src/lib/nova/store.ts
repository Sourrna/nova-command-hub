import { useSyncExternalStore } from "react";

export type Stage = "idea" | "strategy" | "draft" | "review" | "approved" | "published" | "measured";
export const STAGES: Stage[] = ["idea", "strategy", "draft", "review", "approved", "published", "measured"];

export interface Task { id: string; title: string; status: "todo" | "doing" | "done"; priority: "low" | "med" | "high"; created: number }
export interface ContentItem { id: string; title: string; channel: string; stage: Stage; notes: string; demo?: boolean; updated: number }
export interface Project { id: string; name: string; status: "active" | "paused" | "done"; progress: number; demo?: boolean }
export interface Memory { id: string; text: string; tag: string; created: number }
export interface LogEntry { id: string; at: number; kind: "info" | "approval" | "blocked" | "local"; message: string }
export interface Approval { id: string; at: number; action: string; target: string; connector: string; state: "pending" | "approved" | "rejected" | "invalidated"; ref?: string | undefined }

export interface NovaState {
  lang: "en" | "fa";
  disabled: string[]; // connectors manually disconnected by user
  tasks: Task[]; content: ContentItem[]; projects: Project[]; memory: Memory[];
  log: LogEntry[]; approvals: Approval[];
}

const KEY = "nova-brand-os-v1";
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();
const SEED_AT = Date.UTC(2026, 9, 1, 9, 0);

const seed = (): NovaState => ({
  lang: "en", disabled: [],
  tasks: [
    { id: uid(), title: "Define Q4 positioning statement", status: "doing", priority: "high", created: SEED_AT },
    { id: uid(), title: "Collect 5 case-study wins", status: "todo", priority: "med", created: SEED_AT },
  ],
  content: [
    { id: uid(), title: "Why operators beat strategists", channel: "LinkedIn", stage: "draft", notes: "", demo: true, updated: SEED_AT },
    { id: uid(), title: "Behind the build: Nova OS", channel: "LinkedIn", stage: "idea", notes: "", demo: true, updated: SEED_AT },
    { id: uid(), title: "Weekly newsletter #12", channel: "Notion", stage: "review", notes: "", demo: true, updated: SEED_AT },
  ],
  projects: [
    { id: uid(), name: "Personal site refresh", status: "active", progress: 40, demo: true },
    { id: uid(), name: "Speaking kit", status: "paused", progress: 15, demo: true },
  ],
  memory: [{ id: uid(), text: "Tone: confident, concise, no hype words.", tag: "voice", created: SEED_AT }],
  log: [{ id: uid(), at: SEED_AT, kind: "info", message: "Workspace initialised with demo data." }],
  approvals: [],
});

let state: NovaState | null = null;
const listeners = new Set<() => void>();
const serverSnapshot = seed();

function load(): NovaState {
  if (state) return state;
  try { const raw = localStorage.getItem(KEY); state = raw ? { ...seed(), ...JSON.parse(raw) } : seed(); }
  catch { state = seed(); }
  return state!;
}

export function update(fn: (s: NovaState) => Partial<NovaState>, logMsg?: string, kind: LogEntry["kind"] = "local") {
  const s = load();
  let next = { ...s, ...fn(s) };
  if (logMsg) next = { ...next, log: [{ id: uid(), at: now(), kind, message: logMsg }, ...next.log].slice(0, 300) };
  state = next;
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

export function useNova<T>(sel: (s: NovaState) => T): T {
  return sel(useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => load(),
    () => serverSnapshot,
  ));
}

export const actions = {
  addTask: (title: string, priority: Task["priority"] = "med") =>
    update((s) => ({ tasks: [{ id: uid(), title, status: "todo", priority, created: now() }, ...s.tasks] }), `Task created: ${title}`),
  setTask: (id: string, p: Partial<Task>) => update((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) }),
    p.status ? `Task moved to ${p.status}` : undefined),
  delTask: (id: string) => confirm('Delete this task? This cannot be undone.') && update((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }), "Task deleted"),
  addContent: (title: string, channel: string) =>
    update((s) => ({ content: [{ id: uid(), title, channel, stage: "idea", notes: "", updated: now() }, ...s.content] }), `Content idea added: ${title}`),
  setContent: (id: string, p: Partial<ContentItem>) => {
    const cur = load().content.find((c) => c.id === id);
    const edited = cur && (("title" in p && p.title !== cur.title) || ("notes" in p && p.notes !== cur.notes));
    const invalidate = !!edited && !!cur && (cur.stage === "approved" || load().approvals.some((a) => a.ref === id && (a.state === "pending" || a.state === "approved")));
    update((s) => ({
      content: s.content.map((c) => (c.id === id ? { ...c, ...p, ...(invalidate && c.stage === "approved" ? { stage: "review" as Stage } : {}), updated: now() } : c)),
      approvals: invalidate ? s.approvals.map((a) => (a.ref === id && (a.state === "pending" || a.state === "approved") ? { ...a, state: "invalidated" as const } : a)) : s.approvals,
    }), invalidate ? `Edit invalidated approval for "${cur!.title}" — returned to review` : p.stage ? `Content moved to ${p.stage}` : undefined, invalidate ? "approval" : "local");
  },
  delContent: (id: string) => confirm('Delete this content item? This cannot be undone.') && update((s) => ({ content: s.content.filter((c) => c.id !== id) }), "Content deleted"),
  addProject: (name: string) => update((s) => ({ projects: [{ id: uid(), name, status: "active", progress: 0 }, ...s.projects] }), `Project created: ${name}`),
  setProject: (id: string, p: Partial<Project>) => update((s) => ({ projects: s.projects.map((x) => (x.id === id ? { ...x, ...p } : x)) })),
  delProject: (id: string) => confirm('Delete this project? This cannot be undone.') && update((s) => ({ projects: s.projects.filter((x) => x.id !== id) }), "Project deleted"),
  addMemory: (text: string, tag: string) => update((s) => ({ memory: [{ id: uid(), text, tag, created: now() }, ...s.memory] }), "Memory saved"),
  delMemory: (id: string) => confirm('Delete this memory? This cannot be undone.') && update((s) => ({ memory: s.memory.filter((m) => m.id !== id) }), "Memory removed"),
  requestApproval: (action: string, target: string, connector: string, ref?: string) =>
    update((s) => ({ approvals: [{ id: uid(), at: now(), action, target, connector, state: "pending", ref }, ...s.approvals] }),
      `Approval requested: ${action} → ${target}`, "approval"),
  resolveApproval: (id: string, approved: boolean, connectorReady: boolean) => {
    const a = load().approvals.find((x) => x.id === id);
    if (!a) return;
    update((s) => ({ approvals: s.approvals.map((x) => (x.id === id ? { ...x, state: approved ? "approved" : "rejected" } : x)) }),
      approved
        ? connectorReady
          ? `Approved: ${a.action}. Adapter not implemented — no external call made.`
          : `Approved: ${a.action}. Blocked — ${a.connector} not connected; no external call made.`
        : `Rejected: ${a.action}`,
      approved ? "blocked" : "approval");
  },
  toggleConnector: (id: string) => update((s) => ({ disabled: s.disabled.includes(id) ? s.disabled.filter((x) => x !== id) : [...s.disabled, id] }),
    `Connector ${id} toggled`),
  setLang: (lang: "en" | "fa") => update(() => ({ lang })),
  clearDemo: () => update((s) => ({ content: s.content.filter((c) => !c.demo), projects: s.projects.filter((p) => !p.demo) }), "Demo data cleared"),
  reset: () => { state = seed(); localStorage.setItem(KEY, JSON.stringify(state)); listeners.forEach((l) => l()); },
};
