import type { Metadata } from "next";
import WelcomePage from "@/components/welcome/WelcomePage";

/**
 * The `/welcome` route. Renders the video-driven welcome/sell page for every
 * visitor regardless of connection state. Linked from Settings ("View the
 * welcome page") and the DevForceLandingButton. Also the target of the
 * first-visit redirect in providers.tsx.
 *
 * The page itself is a client component (WelcomePage) that renders the full
 * video-led layout. This server wrapper exists solely so Next.js can export
 * the metadata block, which is not allowed in client components.
 */
export const metadata: Metadata = {
  title: "Welcome to ResearchOS",
  description:
    "A free, local-first electronic lab notebook for research labs. Plan experiments, run protocols, design plasmids, and write it all up. Your data stays a plain folder on your own machine.",
};

export default function WelcomeRoute() {
  return <WelcomePage />;
}
