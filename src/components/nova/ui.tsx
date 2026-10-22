import type { ReactNode } from "react";
import { STATUS_META, type ConnectorStatus } from "@/lib/nova/connectors";
import { cn } from "@/lib/utils";

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="label-hud">{kicker}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-silver md:text-3xl">{title}</h1>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </header>
  );
}

export function Panel({ title, action, className, children, glow }: { title?: string; action?: ReactNode; className?: string; children: ReactNode; glow?: boolean }) {
  return (
    <section className={cn("panel p-4 scanline", glow && "panel-glow glow-pulse", className)}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="label-hud">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const toneClass: Record<string, string> = { ok: "text-ok", warn: "text-warn", idle: "text-idle", bad: "text-destructive" };

export function StatusChip({ status }: { status: ConnectorStatus }) {
  const m = STATUS_META[status];
  return <span className={cn("chip", toneClass[m.tone])}><span className="dot" />{m.label}</span>;
}

export function DemoTag() {
  return <span className="chip text-warn" title="Sample data, not from a live source">DEMO</span>;
}

export function Empty({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="panel p-4">
      <p className="label-hud">{label}</p>
      <p className="mt-2 font-mono text-2xl text-silver">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export const fmtTime = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
