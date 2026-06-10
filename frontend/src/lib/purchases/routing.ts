// Department-routing draft builder (PURCHASE_DOCS_AND_ROUTING.md, routing slice 3).
//
// Pure helpers that turn a purchase + the PI's routing templates into a drafted
// email and a mailto: URL. Draft-and-hand-off: the URL opens the PI's own mail
// client with To / Subject / Body pre-filled, so it sends from their real
// address with no stored credentials. A drafted email cannot carry the PDF, so
// the body reminds the sender to attach it (the doc is openable from the row).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type { PurchaseItem } from "@/lib/types";
import type { PurchaseRoutingConfig } from "@/lib/settings/user-settings";

/** Values substituted into the routing templates. */
export interface RoutingVars {
  item: string;
  grant: string;
  vendor: string;
  total: string;
  me: string;
}

/** Replace every {placeholder} in a template with its value. Unknown
 *  placeholders are left as-is; a missing value renders empty. */
export function fillRoutingTemplate(
  template: string,
  vars: RoutingVars,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? (vars[key as keyof RoutingVars] ?? "") : whole,
  );
}

/** Build a mailto: URL with the To, Subject, and Body correctly encoded. */
export function buildMailto(
  to: string,
  subject: string,
  body: string,
): string {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const query = params.toString();
  // URLSearchParams encodes spaces as "+", but mail clients want %20 in a
  // mailto query, so normalize.
  const normalized = query.replace(/\+/g, "%20");
  return `mailto:${encodeURIComponent(to)}${normalized ? `?${normalized}` : ""}`;
}

/** Build the drafted subject + body for a purchase from the routing templates. */
export function buildDepartmentDraft(
  item: PurchaseItem,
  config: Pick<PurchaseRoutingConfig, "subjectTemplate" | "bodyTemplate">,
  vars: RoutingVars,
): { subject: string; body: string } {
  return {
    subject: fillRoutingTemplate(config.subjectTemplate, vars),
    body: fillRoutingTemplate(config.bodyTemplate, vars),
  };
}

/** Convenience: build the full mailto for a purchase + a chosen recipient. */
export function buildDepartmentMailto(
  to: string,
  item: PurchaseItem,
  config: Pick<PurchaseRoutingConfig, "subjectTemplate" | "bodyTemplate">,
  vars: RoutingVars,
): string {
  const { subject, body } = buildDepartmentDraft(item, config, vars);
  return buildMailto(to, subject, body);
}
