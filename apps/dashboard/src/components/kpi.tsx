"use client";

import { useState } from "react";

type KpiProps = {
  label: string;
  value: string;
  hint?: string;
  hero?: boolean;
  muted?: boolean;
};

export function Kpi({ label, value, hint, hero = false, muted = false }: KpiProps) {
  // Re-key the number when the value changes so the CSS flash animation restarts.
  const [seen, setSeen] = useState({ value, key: 0 });
  if (seen.value !== value) setSeen({ value, key: seen.key + 1 });
  const flash = seen.key > 0;

  return (
    <div className={`card px-5 py-4 min-w-0 ${hero ? "sm:col-span-2 lg:col-span-1" : ""}`}>
      <div className="label">{label}</div>
      <div
        key={seen.key}
        className={`num mt-2 font-semibold tracking-tight leading-none ${flash ? "num-flash" : ""} ${
          hero ? "text-4xl sm:text-5xl text-accent-ink" : "text-3xl"
        } ${muted ? "text-ink-2" : ""}`}
      >
        {value}
      </div>
      {hint && <p className="mt-2 text-xs text-ink-3 leading-snug">{hint}</p>}
    </div>
  );
}
