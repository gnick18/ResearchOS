// Social lane, thin route helpers (lab-domains, social lane).
//
// A self-contained JSON-response helper for the social-lane route handlers so
// they do not reach into the directory lane for it. Kept deliberately tiny.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/**
 * Builds a JSON Response with the given status. The App Router route handlers
 * return a Web Response directly, so this keeps each handler a few lines.
 */
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
