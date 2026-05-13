import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export default function Kbd({ children }: Props) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5em] px-1.5 py-0.5 rounded border border-gray-300 bg-gray-50 text-gray-700 text-[11px] font-mono leading-none shadow-[inset_0_-1px_0_rgb(229_231_235)]">
      {children}
    </kbd>
  );
}
