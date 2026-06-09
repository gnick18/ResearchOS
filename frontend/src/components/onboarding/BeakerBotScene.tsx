// Mascot illustrations for the 3 account tiers, served as static brand SVGs.
// Canonical art lives in brand/beakerbot-{solo,computer,lab}.svg and is mirrored
// into frontend/public/brand/ for serving. Rendered via <img> so the brand art
// has one source of truth and stays out of inline-svg icon-guard scope.
//
// No em-dashes, no emojis, no mid-sentence colons.

export type BeakerBotSceneName = "solo" | "computer" | "lab";

const SRC: Record<BeakerBotSceneName, string> = {
  solo: "/brand/beakerbot-solo.svg",
  computer: "/brand/beakerbot-computer.svg",
  lab: "/brand/beakerbot-lab.svg",
};

const ALT: Record<BeakerBotSceneName, string> = {
  solo: "BeakerBot on its own",
  computer: "BeakerBot at a computer, sharing with another researcher",
  lab: "A BeakerBot lab head leading a team",
};

export function BeakerBotScene({
  name,
  className,
}: {
  name: BeakerBotSceneName;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand SVG, no optimization needed
    <img
      src={SRC[name]}
      alt={ALT[name]}
      className={className}
      draggable={false}
    />
  );
}

export default BeakerBotScene;
