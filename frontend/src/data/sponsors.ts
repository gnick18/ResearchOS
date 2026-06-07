/**
 * Shared sponsor data and type.
 *
 * Lives in its own module so both the Thanks page and the site-wide
 * SponsorStrip can import it without a circular dependency (the strip used to
 * have to reach into components/thanks/ThanksPage for the type).
 *
 * The list is hand-curated for now and seeded empty in sponsors.json. A live
 * GitHub Sponsors fetch would need a token and a server route, not worth it for
 * v1.
 */

import sponsorsData from "@/data/sponsors.json";

/** A single backer on the sponsor wall. */
export interface Sponsor {
  name: string;
  url?: string;
  logo?: string;
  tier: "bench" | "lab" | "institute";
}

export const sponsors = sponsorsData as Sponsor[];
