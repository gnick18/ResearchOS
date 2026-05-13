import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/** Numbered ordered list with extra spacing between items. Use one
 *  <li> per step. Each step can contain a short paragraph and (optionally)
 *  a nested list of sub-actions. */
export function Steps({ children }: Props) {
  return (
    <ol className="my-4 list-decimal pl-6 space-y-2.5 text-gray-800 leading-relaxed marker:text-gray-500 marker:font-semibold">
      {children}
    </ol>
  );
}

/** A single step. Renders as <li> so it counts in the parent <ol>. */
export function Step({ children }: Props) {
  return <li className="pl-1 [&>p:first-child]:mt-0">{children}</li>;
}
