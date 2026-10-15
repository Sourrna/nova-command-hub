import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity, Bot, Brain, Cpu, FileText, FolderKanban, Gauge, Github, Heart, Linkedin, Menu, NotebookText, Puzzle, Settings, X, ShieldCheck,
} from "lucide-react";
import { useNova } from "@/lib/nova/store";
import { useT } from "@/lib/nova/i18n";
import { cn } from "@/lib/utils";

const NAV = [
  { group: "Operations", items: [
    { to: "/", label: "Command Center", icon: Gauge },
    { to: "/core", label: "Nova Core", icon: Cpu },
    { to: "/content", label: "Content Studio", icon: FileText },
    { to: "/projects", label: "Projects", icon: FolderKanban },
    { to: "/memory", label: "Memory", icon: Brain },
  ]},
  { group: "Connectors", items: [
    { to: "/plugins", label: "Plugin Hub", icon: Puzzle },
    { to: "/models", label: "AI Models", icon: Bot },
    { to: "/notion", label: "Notion", icon: NotebookText },
    { to: "/lovable", label: "Lovable", icon: Heart },
    { to: "/github", label: "GitHub", icon: Github },
    { to: "/linkedin", label: "LinkedIn", icon: Linkedin },
  ]},
  { group: "Workspace", items: [
    { to: "/activity", label: "Activity Log", icon: Activity },
    { to: "/settings", label: "Settings", icon: Settings },
  ]},
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const lang = useNova((s) => s.lang);
  const pending = useNova((s) => s.approvals.filter((a) => a.state === "pending").length);
  const t = useT();

  useEffect(() => { document.documentElement.dir = lang === "fa" ? "rtl" : "ltr"; document.documentElement.lang = lang; }, [lang]);
  useEffect(() => setOpen(false), [path]);

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "fixed inset-y-0 start-0 z-40 w-64 border-e bg-sidebar backdrop-blur-xl transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full",
        )}
        aria-label="Primary"
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full border border-accent bg-primary font-mono text-xs panel-glow">N</span>
            <span className="font-mono text-sm tracking-[0.2em] text-silver">NOVA·OS</span>
          </Link>
          <button className="btn btn-ghost lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={16} /></button>
        </div>
        <nav className="h-[calc(100vh-3.5rem)] overflow-y-auto p-3">
          {NAV.map((g) => (
            <div key={g.group} className="mb-4">
              <p className="label-hud px-2 pb-1">{t(g.group)}</p>
              {g.items.map(({ to, label, icon: Icon }) => {
                const active = to === "/" ? path === "/" : path.startsWith(to);
                return (
                  <Link key={to} to={to}
                    className={cn("flex items-center gap-3 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent",
                      active && "bg-sidebar-accent text-silver shadow-[inset_2px_0_0_var(--accent)]")}>
                    <Icon size={16} />{t(label)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-background/70 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/70 px-4 backdrop-blur-xl">
          <button className="btn btn-ghost lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={16} /></button>
          <span className="label-hud hidden sm:inline">Personal Brand Ops · MVP · local workspace</span>
          <div className="ms-auto flex items-center gap-2">
            <Link to="/activity" className="btn btn-ghost" aria-label={`${pending} pending approvals`}>
              <ShieldCheck size={15} /> <span className="font-mono text-xs">{pending}</span>
            </Link>
            <span className="chip text-ok"><span className="dot" />ONLINE</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
