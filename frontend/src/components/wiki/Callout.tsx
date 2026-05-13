import type { ReactNode } from "react";

type Variant = "info" | "tip" | "warning" | "danger";

interface Props {
  variant?: Variant;
  title?: string;
  children: ReactNode;
}

const STYLES: Record<Variant, { wrap: string; title: string; icon: string }> = {
  info: {
    wrap: "border-blue-200 bg-blue-50 text-blue-900",
    title: "text-blue-900",
    icon: "ℹ",
  },
  tip: {
    wrap: "border-emerald-200 bg-emerald-50 text-emerald-900",
    title: "text-emerald-900",
    icon: "✓",
  },
  warning: {
    wrap: "border-amber-200 bg-amber-50 text-amber-900",
    title: "text-amber-900",
    icon: "!",
  },
  danger: {
    wrap: "border-rose-200 bg-rose-50 text-rose-900",
    title: "text-rose-900",
    icon: "⚠",
  },
};

export default function Callout({ variant = "info", title, children }: Props) {
  const s = STYLES[variant];
  return (
    <aside className={`my-4 rounded-lg border px-4 py-3 text-sm leading-relaxed ${s.wrap}`}>
      <div className="flex items-baseline gap-2">
        <span aria-hidden className="font-bold leading-none">
          {s.icon}
        </span>
        <div className="flex-1">
          {title ? <div className={`font-semibold mb-1 ${s.title}`}>{title}</div> : null}
          <div className="[&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1">{children}</div>
        </div>
      </div>
    </aside>
  );
}
