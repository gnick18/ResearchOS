"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import BeakerBot, { type BeakerBotPose } from "@/components/BeakerBot";
import BeakerBotSpeechBubble from "@/components/beakerbot/SpeechBubble";

// <BeakerBotPeek> — sprinkles a "living" BeakerBot behind a section so he peeks
// out from an edge as you scroll it into view. He slides up from behind the
// content, plays a one-shot reaction pose (amazed / waving / ...), then settles
// into an `alive` resting pose where he keeps blinking, swaying, and gaze-
// drifting (Grant's ask: not totally still). When the section scrolls back out
// he ducks behind the content again and re-arms, so each reveal is a fresh
// little moment rather than a frozen ornament.
//
// He renders BEHIND the children (the children form a relative layer above
// him), so the part of him overlapping the content is occluded and only the
// poking-out part shows. Works against a solid child (a framed demo, a card,
// a table). Decorative throughout, so the whole thing is aria-hidden.

type Anchor = "top-right" | "top-left" | "left" | "right";

interface AnchorSpec {
  /** Absolute-position offsets for the bot wrapper. */
  pos: { top?: string; bottom?: string; left?: string; right?: string };
  /** Transform while hidden behind the content. */
  hidden: string;
  /** Transform while peeking out. */
  peek: string;
  /** Default pointing direction for directional reaction poses. */
  facing: "left" | "right";
}

// Each anchor parks the bot at an edge and defines how far he slides between
// hidden and peeking. Percentages are of the bot's own box, so they scale with
// `size`. Tuned against the welcome page's framed demos + cards.
const ANCHORS: Record<Anchor, AnchorSpec> = {
  // Head pops up over the TOP edge, offset toward the right.
  "top-right": {
    pos: { top: "0", right: "9%" },
    hidden: "translateY(42%)",
    peek: "translateY(-50%)",
    facing: "left",
  },
  "top-left": {
    pos: { top: "0", left: "9%" },
    hidden: "translateY(42%)",
    peek: "translateY(-50%)",
    facing: "right",
  },
  // Pokes in from the LEFT edge, vertically centred-ish, facing the content.
  left: {
    pos: { top: "42%", left: "0" },
    hidden: "translate(-115%, -50%)",
    peek: "translate(-58%, -50%)",
    facing: "right",
  },
  right: {
    pos: { top: "42%", right: "0" },
    hidden: "translate(115%, -50%)",
    peek: "translate(58%, -50%)",
    facing: "left",
  },
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    if (mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);
  return reduced;
}

export interface BeakerBotPeekProps {
  /** The content he peeks from behind (a framed demo, a card, a table). */
  children: ReactNode;
  /** Which edge he peeks from. Default "top-right". */
  anchor?: Anchor;
  /** Brief one-shot pose played on reveal. Default "amazed". */
  reactionPose?: BeakerBotPose;
  /** Resting pose he settles into, rendered `alive` so he keeps blinking +
   *  swaying. Must be an alive-friendly pose (idle / pointing / pointing-up /
   *  pointing-down) or it just plays its own loop. Default "idle". */
  restPose?: BeakerBotPose;
  /** Tiny speech bubble shown during the reaction (e.g. "whoa"). Omit for none. */
  bubble?: string;
  /** Tailwind size for the bot. Default "h-20 w-20". */
  size?: string;
  /** How long the reaction pose holds before settling, ms. Default 1100. */
  reactionMs?: number;
  /** Extra classes on the relative wrapper. */
  className?: string;
}

export default function BeakerBotPeek({
  children,
  anchor = "top-right",
  reactionPose = "amazed",
  restPose = "idle",
  bubble,
  size = "h-20 w-20",
  reactionMs = 1100,
  className,
}: BeakerBotPeekProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<"hidden" | "reacting" | "resting">(
    "hidden",
  );
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Re-arm only from hidden, so scrolling within the section does not
          // re-trigger the reaction.
          if (phaseRef.current === "hidden") {
            setPhase("reacting");
            settle = setTimeout(() => setPhase("resting"), reactionMs);
          }
        } else {
          if (settle) clearTimeout(settle);
          setPhase("hidden");
        }
      },
      // Fire once he is comfortably on screen, and give a small bottom margin
      // so he ducks away a touch before fully leaving.
      { threshold: 0.5, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (settle) clearTimeout(settle);
    };
  }, [reactionMs]);

  const spec = ANCHORS[anchor];
  const visible = phase !== "hidden";
  // Reduced motion: skip the slide, just sit at the peek position statically.
  const transform = reduced ? spec.peek : visible ? spec.peek : spec.hidden;
  const pose = phase === "reacting" ? reactionPose : restPose;
  const directional =
    pose === "pointing" || pose === "waving" || pose.startsWith("pointing");

  return (
    <div ref={ref} className={`relative ${className ?? ""}`.trim()}>
      {/* Bot lives behind the content. aria-hidden: purely decorative. */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          ...spec.pos,
          transform,
          transition: reduced
            ? undefined
            : "transform 520ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          willChange: "transform",
        }}
      >
        <div className="relative">
          {bubble && phase === "reacting" && (
            <BeakerBotSpeechBubble
              tone="default"
              direction="down"
              position={{ bottom: "calc(100% + 8px)", left: "50%" }}
              style={{
                animation: reduced
                  ? undefined
                  : "brand-bubble-in 240ms ease-out forwards",
                transform: reduced ? "translateX(-50%)" : undefined,
              }}
            >
              {bubble}
            </BeakerBotSpeechBubble>
          )}
          <BeakerBot
            pose={pose}
            alive={phase === "resting"}
            direction={directional ? spec.facing : undefined}
            className={`${size} text-brand-sky`}
          />
        </div>
      </div>

      {/* Content sits above the bot so he reads as hiding behind it. */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
