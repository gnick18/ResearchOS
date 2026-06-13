import type { ReactNode } from "react";

/**
 * A rainbow-gradient frame around a visual: the pastel brand ramp painted as a
 * thin padded border behind a white inner card. Children render inside. Shared
 * across the marketing pages (welcome demo windows, /ai result cards, etc.).
 *
 * No hooks, so it works in both server and client pages.
 */
export default function RainbowFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`brand-rainbow-bg rounded-[20px] p-[3px] shadow-[0_24px_60px_rgba(15,40,80,0.12)] ${className ?? ""}`}
    >
      <div className="overflow-hidden rounded-[17px] bg-white">{children}</div>
    </div>
  );
}
