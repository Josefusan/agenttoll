import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export function Card({ title, subtitle, action, children, className = "", bodyClassName = "" }: CardProps) {
  return (
    <section className={`card flex flex-col min-w-0 ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-medium text-ink">{title}</h2>}
            {subtitle && <p className="text-xs text-ink-3 mt-0.5 truncate">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={`px-5 pb-5 flex-1 min-w-0 ${title ? "" : "pt-5"} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?: "neutral" | "accent" | "base" | "warn" | "good" | "danger";
  children: ReactNode;
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-surface-2 text-ink-2 border-line-strong",
    accent: "bg-accent-soft text-accent-ink border-accent-line",
    base: "bg-base-soft text-[#aeb4ff] border-[rgba(111,120,232,0.45)]",
    warn: "bg-warn-soft text-warn border-[rgba(224,168,74,0.4)]",
    good: "bg-[rgba(76,195,138,0.12)] text-good border-[rgba(76,195,138,0.35)]",
    danger: "bg-[rgba(230,103,103,0.12)] text-danger border-[rgba(230,103,103,0.35)]",
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
