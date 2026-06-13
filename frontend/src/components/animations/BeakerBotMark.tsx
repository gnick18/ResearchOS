// A small, static BeakerBot mark for inline badges (the Data Hub results
// interpretation header, and anywhere else a tiny "this is BeakerBot speaking"
// glyph is wanted). It draws the SAME sky-blue beaker character as IntroBeaker
// (same viewBox, same paths, same face), minus the bubbling animation and the
// pastel-rainbow liquid, so it stays crisp at 16-20px. The mascot is always
// BeakerBot, never a generic mark.
//
// Lives under components/animations/ on purpose. That directory is exempt from
// the icon-guard ratchet (see frontend/scripts/update-icon-baseline.mjs), which
// is the right home for a decorative mascot drawing rather than a registry icon.
// The fill uses currentColor so the badge tints to whatever accent color the
// caller sets, keeping it readable on the sky accent-soft box.
//
// No emojis, no em-dashes, no mid-sentence colons.

export function BeakerBotMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="8 3 24 31"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* Glass body fill so the face reads on a tinted background. */}
      <path
        d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z"
        fill="white"
        stroke="none"
      />
      {/* A soft single-tone liquid (currentColor at low opacity), no rainbow. */}
      <path
        d="M 12 19 Q 14 17.8, 16 19 T 20 19 T 24 19 T 28 19 L 28 24 C 28 30, 24 32, 20 32 C 16 32, 12 30, 12 24 L 12 19 Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="none"
      />
      {/* Lip curl, glass outline, rim. */}
      <path d="M22 8 C 22 6, 24 4, 26 6" />
      <path d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12" />
      <path d="M11 12 L29 12" />
      {/* Eyes + smile. */}
      <circle cx="17" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="23" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <path d="M18 22 Q 20 24, 22 22" />
      {/* Little arms. */}
      <path d="M14 26 L15.5 26" />
      <path d="M24.5 26 L26 26" />
    </svg>
  );
}

export default BeakerBotMark;
