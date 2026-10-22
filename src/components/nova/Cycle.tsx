import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type CmdPhase = "idle" | "planning" | "executing" | "review" | "done" | "error";

const PHASE_META: Record<CmdPhase, { label: string; tone: string }> = {
  idle: { label: "Standby", tone: "text-idle" },
  planning: { label: "Planning", tone: "text-warn" },
  executing: { label: "Executing", tone: "text-accent" },
  review: { label: "Awaiting review", tone: "text-warn" },
  done: { label: "Complete", tone: "text-ok" },
  error: { label: "Failed", tone: "text-destructive" },
};

export function PhasePill({ phase }: { phase: CmdPhase }) {
  const m = PHASE_META[phase];
  return <span className={cn("chip", m.tone)}><span className="dot" />{m.label}</span>;
}

export function GoalInput({
  value, onChange, onSubmit, disabled, placeholder = "Describe a goal — e.g. publish this week's LinkedIn post to three channels…",
}: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; disabled?: boolean; placeholder?: string;
}) {
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <textarea
        className="field min-h-[72px] resize-y"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="label-hud-sm">{value.length} chars</span>
        <button type="submit" className="btn btn-primary" disabled={disabled || !value.trim()}>Plan execution</button>
      </div>
    </form>
  );
}

export function Stepper({ steps }: { steps: { label: string; state: "pending" | "active" | "done" | "failed" | "running" | "skipped" }[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2">
          <span className={cn(
            "grid h-5 w-5 place-items-center rounded-full font-mono text-[0.62rem] border",
            s.state === "done" && "border-ok bg-ok text-foreground",
            (s.state === "active" || s.state === "running") && "border-accent bg-accent text-foreground",
            s.state === "failed" && "border-destructive bg-destructive text-foreground",
            (s.state === "pending" || s.state === "skipped") && "border-border text-muted-foreground",
          )}>{i + 1}</span>
          <span className={cn("label-hud-sm", s.state === "active" || s.state === "running" ? "text-silver" : s.state === "skipped" ? "text-muted-foreground" : "")}>{s.label}</span>
          {i < steps.length - 1 && <span className="text-border">›</span>}
        </li>
      ))}
    </ol>
  );
}

export function StateBlock({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed p-8 text-center">
      <p className="text-sm font-medium text-silver">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function LoadingLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="h-2 w-2 rounded-full bg-accent pulse-dot" />
      <span className="label-hud">{label}</span>
    </div>
  );
}