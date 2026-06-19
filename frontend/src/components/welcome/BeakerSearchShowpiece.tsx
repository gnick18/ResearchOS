"use client";

/**
 * BeakerSearchShowpiece: the full-bleed beaker-blue AI band that sits as the
 * second beat of the welcome page (right under the cost lead). Ported faithfully
 * from docs/mockups/2026-06-13-welcome-ai-showpiece.html (the `.aiband` band,
 * its gradient + rising-bubble CSS, and the self-running `runDemo()` timeline).
 *
 * The right column is a living BeakerSearch demo. It loops on its own:
 *   idle -> type the query char-by-char -> thinking shimmer on the bar ->
 *   morph the answer panel open -> stagger two result cards + a chart card in ->
 *   grow the chart bars (failures in red) -> type the verdict line -> hold ->
 *   collapse -> loop. The real <BeakerBot> mascot rides the avatar slot with a
 *   live status line.
 *
 * Scope rule: the demo only relays counts and records ("found 4 of your 11
 * runs"), it never interprets or concludes. The verdict text is deterministic
 * fixture copy, not a model output.
 *
 * prefers-reduced-motion: the band renders the answer already-open and static
 * (query filled, cards + chart shown, no loop, no bubbles), read once at mount
 * via matchMedia.
 *
 * Voice rules: no em-dashes, no emojis, no mid-sentence colons. The only mascot
 * is BeakerBot. Every glyph is the Icon registry or the BeakerBot component, so
 * the file carries no inline vector markup (icon-guard clean).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import BeakerBot from "@/components/BeakerBot";
import { Icon } from "@/components/icons";

const QUERY = "Show my PCR runs that failed last month";
const VERDICT =
  "Found 4 of your 11 runs last month that failed. Here they are, with the gel images.";

/** The six bars in the mini chart, failures flagged red, with their grown
 *  heights in px (verbatim from the mockup's data-h values). */
const BARS: { h: number; fail: boolean }[] = [
  { h: 46, fail: false },
  { h: 70, fail: true },
  { h: 38, fail: false },
  { h: 66, fail: true },
  { h: 52, fail: false },
  { h: 74, fail: true },
];

/** Rising-bubble seeds (left%, base duration s, size px) verbatim from the
 *  mockup, so the blue field reads the same. Bubbles are pure CSS. */
const BUBBLE_SEEDS: [number, number, number][] = [
  [8, 16, 15],
  [20, 9, 22],
  [33, 13, 12],
  [47, 20, 18],
  [59, 11, 26],
  [71, 17, 14],
  [83, 10, 20],
  [92, 15, 16],
  [14, 7, 10],
  [64, 8, 9],
];

export interface BeakerSearchShowpieceProps {
  /** The page's "get started" handler, wired to the primary CTA. */
  onGetStarted: () => void;
}

export default function BeakerSearchShowpiece({
  onGetStarted,
}: BeakerSearchShowpieceProps) {
  // The whole animation is driven through these pieces of state. Refs hold the
  // cancellation token and timer handles so the loop stops cleanly on unmount.
  const [reduced, setReduced] = useState(false);
  const [ready, setReady] = useState(false); // matchMedia read, render gate

  const [typed, setTyped] = useState(""); // chars typed into the bar so far
  const [showCaret, setShowCaret] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [open, setOpen] = useState(false); // answer panel morphed open
  const [verdict, setVerdict] = useState("");
  const [cardsIn, setCardsIn] = useState(0); // how many of the 3 cards are in
  const [barsGrown, setBarsGrown] = useState(false);
  const [state, setStateLine] = useState("ready when you are");

  const tokenRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Read reduced-motion once at mount (SSR-safe gate via `ready`).
  useEffect(() => {
    const mq =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    setReduced(!!mq?.matches);
    setReady(true);
  }, []);

  // The looping timeline, mirroring the mockup's runDemo(). A monotonic token
  // cancels any in-flight loop on unmount (alive() === token still current).
  useEffect(() => {
    if (!ready || reduced) return;

    const myToken = ++tokenRef.current;
    const alive = () => myToken === tokenRef.current;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        timersRef.current.push(t);
      });

    const run = async (): Promise<void> => {
      // reset
      setThinking(false);
      setOpen(false);
      setCardsIn(0);
      setBarsGrown(false);
      setVerdict("");
      setTyped("");
      setShowCaret(false);
      setStateLine("ready when you are");
      await sleep(900);
      if (!alive()) return;

      // type the query char by char
      setShowCaret(true);
      setStateLine("listening");
      for (let i = 0; i < QUERY.length; i++) {
        if (!alive()) return;
        setTyped(QUERY.slice(0, i + 1));
        await sleep(38 + (QUERY[i] === " " ? 30 : 0));
      }
      setShowCaret(false);
      await sleep(360);
      if (!alive()) return;

      // ask pressed -> thinking shimmer
      setPressing(true);
      await sleep(140);
      setPressing(false);
      setThinking(true);
      setStateLine("reading your notes and results...");
      await sleep(1500);
      if (!alive()) return;
      setThinking(false);
      setStateLine("found it");

      // morph open + type the verdict line
      setOpen(true);
      await sleep(280);
      if (!alive()) return;
      for (let i = 0; i < VERDICT.length; i++) {
        if (!alive()) return;
        setVerdict(VERDICT.slice(0, i + 1));
        await sleep(15);
      }

      // stagger the cards in (2 result cards + the chart card)
      for (let c = 1; c <= 3; c++) {
        if (!alive()) return;
        setCardsIn(c);
        await sleep(180);
      }
      // draw the chart bars
      await sleep(120);
      if (!alive()) return;
      setBarsGrown(true);

      await sleep(3200);
      if (!alive()) return;
      // collapse + loop
      setOpen(false);
      setStateLine("ask another");
      await sleep(1100);
      if (!alive()) return;
      void run();
    };

    void run();

    return () => {
      // bump the token so any awaiting loop bails, and clear pending timers.
      tokenRef.current++;
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current = [];
    };
  }, [ready, reduced]);

  // Reduced-motion: present the finished state, static. (Also the SSR / first
  // paint default until `ready`, so the markup never flashes a half state.)
  const staticView = !ready || reduced;
  const qText = staticView ? QUERY : typed;
  const qIsPlaceholder = !staticView && typed.length === 0 && !showCaret;
  const panelOpen = staticView || open;
  const verdictText = staticView ? VERDICT : verdict;
  const cardShown = (i: number) => staticView || cardsIn > i;
  const barsShown = staticView || barsGrown;
  const stateLine = staticView ? "ask another" : state;

  return (
    <section
      className="ros-aiband relative overflow-hidden px-8 py-14 text-[#eaf6ff] sm:px-8"
      aria-label="Ask your own research a question with BeakerBot"
    >
      <div aria-hidden className="ros-aigrain absolute inset-0" />
      {!staticView && (
        <div aria-hidden className="absolute inset-0">
          {BUBBLE_SEEDS.map(([left, dur, size], i) => (
            <span
              key={i}
              className="ros-bubble"
              style={{
                left: `${left}%`,
                width: `${size}px`,
                height: `${size}px`,
                animationDuration: `${dur + 6}s`,
                animationDelay: `${-(i * 1.7)}s`,
              }}
            />
          ))}
        </div>
      )}

      <div className="ros-aigrid relative z-[2] mx-auto grid max-w-[1080px] items-center gap-9">
        {/* Left: copy, the free-token gift, CTAs (white on blue). */}
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/[0.14] px-3.5 py-1.5 text-meta font-bold uppercase tracking-[0.06em] text-[#d4eeff]">
            <span
              aria-hidden
              className="inline-block h-[7px] w-[7px] rounded-full bg-[#bfe9ff]"
            />
            Your data, your AI
          </span>
          <h2 className="mt-4 max-w-[16ch] text-[33px] font-extrabold leading-[1.08] tracking-tight text-white md:text-[33px]">
            Ask your own research a question
          </h2>
          <p className="mt-3 max-w-[46ch] text-body leading-relaxed text-[#d8eefc] sm:text-[14.5px]">
            BeakerBot runs over the notes and results you already own. Ask in
            plain English, it finds the records, makes the plot, and writes it
            up. Always your data, never mined.
          </p>

          <div className="mt-[18px] rounded-2xl border border-white/30 bg-white/[0.12] px-4 py-[13px] backdrop-blur-[3px]">
            <span className="block text-lg font-extrabold text-white">
              About 1.6 million free tokens to start
            </span>
            <span className="text-meta text-[#cfe9fb]">
              a one-time gift, around 15 tasks, no card needed
            </span>
          </div>

          <div className="mt-[18px] flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={onGetStarted}
              data-testid="welcome-ai-get-started"
              className="cursor-pointer rounded-xl border border-white bg-white px-[18px] py-[11px] text-body font-extrabold text-brand-action transition-transform hover:scale-[1.02]"
            >
              Start your notebook
            </button>
            <Link
              href="/ai"
              className="cursor-pointer rounded-xl border border-white/40 bg-white/[0.08] px-[18px] py-[11px] text-body font-extrabold text-white transition-colors hover:bg-white/[0.16]"
            >
              See what BeakerBot can do
            </Link>
          </div>

          <p className="mt-3.5 text-meta text-[#cfe9fb]">
            Priced near cost because your data stays on your own machine.{" "}
            <Link
              href="/pricing"
              className="font-bold text-white underline underline-offset-2 hover:text-[#eaf6ff]"
            >
              See how the tokens are priced{" "}
              <span aria-hidden>&rarr;</span>
            </Link>
          </p>
        </div>

        {/* Right: the living BeakerSearch card. */}
        <div className="relative">
          <div className="ros-glass relative rounded-[18px] p-4 text-brand-ink">
            <div className="mb-3 flex items-center gap-2.5">
              <BeakerBot
                pose="idle"
                alive={!staticView}
                ariaLabel="BeakerBot"
                className="h-10 w-10 flex-none text-brand-sky"
              />
              <div>
                <div className="text-meta font-extrabold text-brand-ink sm:text-[12.5px]">
                  BeakerBot
                </div>
                <div className="text-[11px] text-[#64748b] transition-colors">
                  {stateLine}
                </div>
              </div>
            </div>

            <div
              className={`ros-sbar relative flex items-center gap-2.5 overflow-hidden rounded-[13px] border-[1.5px] border-[#d3e2f1] bg-[#f1f5f9] px-3.5 py-3 ${
                thinking ? "ros-sbar-thinking" : ""
              }`}
            >
              <Icon
                name="search"
                className="h-[17px] w-[17px] flex-none text-brand-action"
              />
              <span
                className={`overflow-hidden whitespace-nowrap text-[14px] ${
                  qIsPlaceholder
                    ? "font-medium text-[#64748b]"
                    : "font-semibold text-brand-ink"
                }`}
              >
                {qIsPlaceholder
                  ? "Ask across your own notes and results"
                  : qText}
                {showCaret && <span className="ros-caret" aria-hidden />}
              </span>
              <span
                className={`ml-auto flex-none rounded-[9px] bg-brand-action px-3 py-[7px] text-[12px] font-extrabold text-white transition-transform ${
                  pressing ? "scale-[0.93]" : ""
                }`}
              >
                Ask
              </span>
              <span aria-hidden className="ros-sweep absolute inset-0" />
            </div>

            <div
              className={`ros-answer overflow-hidden ${
                panelOpen ? "ros-answer-open" : ""
              }`}
            >
              <div className="flex min-h-[18px] items-center gap-[7px] text-[13px] font-bold text-brand-ink">
                <span
                  aria-hidden
                  className="h-2 w-2 flex-none rounded-full bg-emerald-600"
                />
                <span>{verdictText}</span>
              </div>

              <div className="ros-rescards mt-[11px] grid gap-2">
                <div
                  className={`ros-rcard rounded-[10px] border border-[#e5e7eb] bg-white px-[11px] py-[9px] ${
                    cardShown(0) ? "ros-rcard-in" : ""
                  }`}
                >
                  <div className="text-[11.5px] font-extrabold text-brand-ink">
                    PCR-2026-118{" "}
                    <span className="rounded-[5px] bg-rose-100 px-[5px] py-[1px] text-[9px] font-extrabold text-rose-600">
                      failed
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-[#64748b]">
                    cyp51A amplicon, low yield, May 6
                  </div>
                </div>

                <div
                  className={`ros-rcard rounded-[10px] border border-[#e5e7eb] bg-white px-[11px] py-[9px] ${
                    cardShown(1) ? "ros-rcard-in" : ""
                  }`}
                >
                  <div className="text-[11.5px] font-extrabold text-brand-ink">
                    PCR-2026-131{" "}
                    <span className="rounded-[5px] bg-rose-100 px-[5px] py-[1px] text-[9px] font-extrabold text-rose-600">
                      failed
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-[#64748b]">
                    gel image attached, May 19
                  </div>
                </div>

                <div
                  className={`ros-chartcard col-span-full rounded-[10px] border border-[#e5e7eb] bg-white p-[11px] ${
                    cardShown(2) ? "ros-rcard-in" : ""
                  }`}
                >
                  <div className="mb-[7px] text-[10.5px] font-bold text-[#64748b]">
                    Runs last month, failures highlighted
                  </div>
                  <div className="flex h-[76px] items-end gap-2">
                    {BARS.map((b, i) => (
                      <span
                        key={i}
                        className={`flex-1 rounded-t-[5px] ${
                          b.fail ? "ros-bar-fail" : "ros-bar"
                        }`}
                        style={{
                          height: barsShown ? `${b.h}px` : "0px",
                          transitionDelay: staticView ? undefined : `${i * 90}ms`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .ros-aiband {
          background:
            radial-gradient(
              120% 120% at 12% 0%,
              #38c0f5 0%,
              rgba(56, 192, 245, 0) 55%
            ),
            radial-gradient(
              120% 130% at 92% 12%,
              #2aa2e6 0%,
              rgba(42, 162, 230, 0) 50%
            ),
            linear-gradient(135deg, #1aa0e6 0%, #1283c9 52%, #0c6bb0 100%);
        }
        @media (max-width: 760px) {
          .ros-aiband {
            padding: 38px 18px 44px;
          }
        }
        .ros-aigrain {
          background-image: radial-gradient(
            rgba(255, 255, 255, 0.16) 1px,
            transparent 1px
          );
          background-size: 22px 22px;
          opacity: 0.5;
          pointer-events: none;
        }
        .ros-bubble {
          position: absolute;
          bottom: -40px;
          border-radius: 999px;
          background: radial-gradient(
            circle at 35% 30%,
            rgba(255, 255, 255, 0.55),
            rgba(255, 255, 255, 0.07) 60%,
            transparent 72%
          );
          box-shadow: inset 0 0 6px rgba(255, 255, 255, 0.25);
          pointer-events: none;
          animation: ros-rise linear infinite;
        }
        @keyframes ros-rise {
          0% {
            transform: translateY(0) scale(0.7);
            opacity: 0;
          }
          12% {
            opacity: 0.7;
          }
          80% {
            opacity: 0.55;
          }
          100% {
            transform: translateY(-120vh) scale(1.05);
            opacity: 0;
          }
        }
        .ros-aigrid {
          grid-template-columns: 0.92fr 1.08fr;
          gap: 34px;
        }
        @media (max-width: 860px) {
          .ros-aigrid {
            grid-template-columns: 1fr;
            gap: 26px;
          }
        }
        .ros-glass {
          background: rgba(255, 255, 255, 0.97);
          box-shadow:
            0 30px 70px rgba(5, 40, 80, 0.42),
            0 2px 0 rgba(255, 255, 255, 0.5) inset;
        }
        .ros-sbar {
          transition:
            border-color 0.25s,
            box-shadow 0.25s;
        }
        .ros-sbar-thinking {
          border-color: var(--brand-sky, #1aa0e6);
          box-shadow: 0 0 0 4px rgba(26, 160, 230, 0.16);
        }
        .ros-caret {
          display: inline-block;
          width: 1.5px;
          height: 16px;
          background: var(--brand-action, #1283c9);
          margin-left: 1px;
          vertical-align: -3px;
          animation: ros-blink 1s steps(1) infinite;
        }
        @keyframes ros-blink {
          50% {
            opacity: 0;
          }
        }
        .ros-sweep {
          background: linear-gradient(
            100deg,
            transparent 30%,
            rgba(26, 160, 230, 0.22) 50%,
            transparent 70%
          );
          transform: translateX(-100%);
          opacity: 0;
        }
        .ros-sbar-thinking .ros-sweep {
          animation: ros-sweep 1.1s ease-in-out infinite;
          opacity: 1;
        }
        @keyframes ros-sweep {
          100% {
            transform: translateX(100%);
          }
        }
        .ros-answer {
          max-height: 0;
          opacity: 0;
          margin-top: 0;
          transition:
            max-height 0.55s cubic-bezier(0.22, 1, 0.36, 1),
            opacity 0.4s,
            margin-top 0.4s;
        }
        .ros-answer-open {
          max-height: 420px;
          opacity: 1;
          margin-top: 12px;
        }
        .ros-rescards {
          grid-template-columns: 1fr 1fr;
        }
        @media (max-width: 520px) {
          .ros-rescards {
            grid-template-columns: 1fr;
          }
        }
        .ros-rcard,
        .ros-chartcard {
          opacity: 0;
          transform: translateY(8px);
          transition:
            opacity 0.35s,
            transform 0.35s;
        }
        .ros-rcard-in {
          opacity: 1;
          transform: none;
        }
        .ros-bar,
        .ros-bar-fail {
          background: linear-gradient(180deg, #4db8f0, #1283c9);
          transition: height 0.6s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ros-bar-fail {
          background: linear-gradient(180deg, #fb7185, #e11d48);
        }
        @media (prefers-reduced-motion: reduce) {
          .ros-bubble,
          .ros-caret,
          .ros-sweep,
          .ros-bar,
          .ros-bar-fail,
          .ros-answer,
          .ros-rcard,
          .ros-chartcard {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </section>
  );
}
