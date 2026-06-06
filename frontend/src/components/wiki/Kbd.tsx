import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export default function Kbd({ children }: Props) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5em] px-1.5 py-0.5 rounded border border-border bg-surface-sunken text-foreground text-meta font-mono leading-none shadow-[inset_0_-1px_0_rgb(229_231_235)]">
      {children}
    </kbd>
  );
}
