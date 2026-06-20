// Lab subdomain TLS provisioning (lab-domains, social lane).
//
// WHY this exists. Native lab sites serve from `<slug>.research-os.com`, but the
// research-os.com zone is hosted on Cloudflare, not Vercel DNS. Vercel only
// auto-issues a WILDCARD cert (`*.research-os.com`) when it owns the zone's
// nameservers, which we are deliberately NOT doing (Cloudflare stays authoritative
// for the apex redirect, the assets CDN, and the wildcard CNAME). On an externally
// hosted zone Vercel instead issues a per-subdomain cert over HTTP-01 the moment a
// domain is added to the project, which is exactly how fakeyeast-lab.research-os.com
// already has a valid cert. So for every OTHER lab to load over HTTPS we must add
// its exact subdomain to the Vercel project. The `*.research-os.com` CNAME already
// routes the HTTP-01 challenge to Vercel, so no per-lab DNS change is needed, only
// this one API call. Without it the app-origin 308 sends a real user to a dead TLS
// endpoint (SSL handshake reset).
//
// The call is best-effort and idempotent. It runs at slug-claim time for immediacy
// and again from a daily reconcile cron, so a transient Vercel outage or a lab that
// predates this code self-heals on the next pass. It is INERT until VERCEL_API_TOKEN
// is set, so the app is byte-identical in behavior until Grant provisions the token.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { LAB_SITES_PUBLIC_DOMAIN, labSiteOrigin } from "./lab-byo";

// The Vercel project + team this app deploys to (from .vercel/project.json). Env
// overrides exist so a fork or a renamed project does not need a code change, but
// the defaults are the live ids so the feature works with only the token set.
const VERCEL_PROJECT_ID =
  process.env.VERCEL_PROJECT_ID ?? "prj_qGzZzF4Fa9fKruGxg89Dg0b1qlFg";
const VERCEL_TEAM_ID =
  process.env.VERCEL_TEAM_ID ?? "team_AA36ATug8lttkt7pXROetQxk";

// A DNS label is the strictest constraint on the host we build, and it matches the
// slug charset the proxy redirect already trusts (resolveAppOriginLabRedirect). The
// slug arriving here was reserved through the registry so it is already valid; this
// is a defense-in-depth guard so nothing unexpected is ever interpolated into the
// hostname we hand to the Vercel API.
const DNS_LABEL = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface ProvisionResult {
  /** True when the subdomain is registered on the project (added now or already
   *  present). False only on a real failure the caller should retry later. */
  ok: boolean;
  /** The host we attempted, for logging and tallies. */
  host: string;
  /** True when this call added the domain; false when it already existed. */
  added?: boolean;
  /** Set when the feature is inert (no token) or the input was rejected. */
  skipped?: string;
  /** HTTP status from Vercel, when a request was made. */
  status?: number;
  /** Short error reason on failure. */
  error?: string;
}

/** Whether provisioning is wired up. False (inert) until the token is set, which is
 *  the single switch that turns the feature on in an environment. */
export function isLabDomainProvisioningEnabled(): boolean {
  return Boolean(process.env.VERCEL_API_TOKEN);
}

/**
 * Registers `<slug>.research-os.com` on the Vercel project so Vercel issues its TLS
 * cert. Never throws (so a caller in a hot path can await it without a try/catch
 * changing the response), idempotent (a domain already on this project is a success),
 * and inert without a token. Cert issuance itself is asynchronous on Vercel's side
 * and needs no further call, the existing wildcard CNAME satisfies the HTTP-01
 * challenge automatically.
 */
export async function provisionLabDomain(
  slug: string,
): Promise<ProvisionResult> {
  const host = `${slug}.${LAB_SITES_PUBLIC_DOMAIN}`;

  const token = process.env.VERCEL_API_TOKEN;
  if (!token) return { ok: true, host, skipped: "no token" };
  if (!DNS_LABEL.test(slug)) return { ok: false, host, skipped: "bad slug" };

  const url = `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/domains?teamId=${VERCEL_TEAM_ID}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: host }),
    });
  } catch {
    // Network error reaching Vercel. The reconcile cron retries.
    return { ok: false, host, error: "network" };
  }

  if (res.status === 200 || res.status === 201) {
    return { ok: true, host, added: true, status: res.status };
  }

  // Vercel returns 409 when the domain is already attached. If it is attached to
  // THIS project that is the steady state we want (idempotent success); only a
  // domain held by a DIFFERENT project/team is a real conflict.
  let code = "";
  try {
    const data = (await res.json()) as { error?: { code?: string } };
    code = data?.error?.code ?? "";
  } catch {
    /* non-JSON body, fall through to the generic path */
  }
  if (
    res.status === 409 &&
    (code === "domain_already_exists" ||
      code === "domain_already_in_use_by_project")
  ) {
    return { ok: true, host, added: false, status: res.status };
  }

  return { ok: false, host, status: res.status, error: code || "request_failed" };
}

export interface ReconcileReport {
  scanned: number;
  added: number;
  existed: number;
  failed: number;
  /** Hosts that failed, so the cron log shows exactly what to look at. */
  failures: string[];
}

/**
 * Ensures every claimed lab slug has its subdomain registered on the Vercel
 * project. This is BOTH the one-time backfill for labs that predate claim-time
 * provisioning AND the ongoing self-heal for any claim whose live API call failed.
 * Runs serially to stay well under Vercel's API rate limits, the lab population is
 * small and this runs at most daily.
 */
export async function reconcileLabDomains(
  slugs: string[],
): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    scanned: 0,
    added: 0,
    existed: 0,
    failed: 0,
    failures: [],
  };
  for (const slug of slugs) {
    report.scanned += 1;
    const r = await provisionLabDomain(slug);
    if (!r.ok) {
      report.failed += 1;
      report.failures.push(r.host);
    } else if (r.added) {
      report.added += 1;
    } else {
      report.existed += 1;
    }
  }
  return report;
}

/** Re-exported for callers that want the canonical public origin alongside a
 *  provision call (e.g. logging the URL a freshly claimed lab will live at). */
export { labSiteOrigin };
