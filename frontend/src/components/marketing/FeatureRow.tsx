import type { ReactNode } from "react";

import Reveal from "@/components/marketing/Reveal";
import Kicker from "@/components/marketing/Kicker";

/**
 * A feature showcase row: text on one side, a framed visual on the other.
 * `flip` puts the visual first on desktop; `tint` gives the tinted band. The
 * whole row reveals as one unit. The workhorse layout of the welcome page,
 * shared so other marketing pages can reuse the same rhythm.
 *
 * No hooks of its own (it renders the client Reveal), so it works in server and
 * client pages alike.
 */
export default function FeatureRow({
  kicker,
  title,
  body,
  pills,
  visual,
  flip = false,
  tint = false,
  children,
}: {
  kicker: string;
  title: string;
  body: ReactNode;
  pills?: string[];
  visual: ReactNode;
  flip?: boolean;
  tint?: boolean;
  /** Optional extra content under the body (e.g. a bullet list or a link). */
  children?: ReactNode;
}) {
  const text = (
    <div className={flip ? "md:order-2" : undefined}>
      <Kicker>{kicker}</Kicker>
      <h2 className="mt-3 max-w-[20ch] text-3xl font-extrabold leading-[1.12] tracking-tight text-brand-ink md:text-[30px]">
        {title}
      </h2>
      <p className="mt-4 max-w-[54ch] text-title leading-relaxed text-[#475569]">
        {body}
      </p>
      {pills && pills.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          {pills.map((p) => (
            <span
              key={p}
              className="flex items-center gap-1.5 text-body font-semibold text-brand-ink"
            >
              <span
                aria-hidden
                className="h-[6px] w-[6px] flex-none rounded-full bg-brand-action"
              />
              {p}
            </span>
          ))}
        </div>
      ) : null}
      {children}
    </div>
  );
  const media = <div className={flip ? "md:order-1" : undefined}>{visual}</div>;

  return (
    <section
      className={`px-6 py-16 sm:px-12 ${
        tint ? "border-y border-[#dbe6f3] bg-[#f4f8fd]" : ""
      }`}
    >
      <Reveal className="mx-auto grid max-w-[1180px] items-center gap-12 md:grid-cols-2">
        {flip ? (
          <>
            {media}
            {text}
          </>
        ) : (
          <>
            {text}
            {media}
          </>
        )}
      </Reveal>
    </section>
  );
}
