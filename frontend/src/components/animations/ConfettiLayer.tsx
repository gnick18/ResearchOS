/**
 * Light confetti layer for the Thanks page Institute card payoff. A custom SVG
 * illustration in the rainbow palette (no emoji), decorative only.
 *
 * It lives under components/animations/ because it is a hand-drawn decorative
 * illustration, not an interface glyph. That directory is the verified home for
 * raw inline SVG art (the icon ratchet guard excludes it), keeping single-glyph
 * icons on the <Icon> registry while bespoke art stays here.
 */
export default function ConfettiLayer() {
  return (
    <svg
      viewBox="0 0 120 120"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <g stroke="none">
        <rect x="14" y="10" width="6" height="6" rx="1" fill="#1AA0E6" transform="rotate(20 17 13)" />
        <circle cx="102" cy="16" r="3.2" fill="#7FC98A" />
        <rect x="96" y="30" width="6" height="6" rx="1" fill="#C79BEC" transform="rotate(-18 99 33)" />
        <circle cx="20" cy="34" r="3.2" fill="#F4B740" />
        <rect x="58" y="8" width="5" height="5" rx="1" fill="#EE8FAE" transform="rotate(12 60 10)" />
        <circle cx="80" cy="44" r="2.6" fill="#7FB8EE" />
      </g>
    </svg>
  );
}
