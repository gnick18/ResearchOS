// BeakerBot AI assistant feature flag (ai foundation bot, 2026-06-10).
//
// Mirrors the DATAHUB_ENABLED pattern in `lib/datahub/config.ts`: a plain
// exported boolean const, default OFF, so the foundation slice (a local dev
// proxy plus a minimal chat panel that round-trips one message to Llama) can
// land on `main` without exposing an unfinished feature. The whole `/ai` route
// gates on this one switch. The server proxy at `/api/ai/chat` is NOT gated by
// this flag, because it is keyed on the SERVER-ONLY AI_API_KEY env, so it is
// already inert (returns a clear error) anywhere the key is absent.
//
// Env-driven so dogfooding does not require hand-editing this const: set
// NEXT_PUBLIC_AI_ASSISTANT_ENABLED=1 in frontend/.env.local. NEXT_PUBLIC_* is
// inlined at build, so restart the dev server after changing it. Default OFF
// when unset, so it stays dark on `main` and in prod until the assistant is
// further along. Flipping prod ON is a deliberate Vercel env action (set the
// var + redeploy), not a code change.
export const AI_ASSISTANT_ENABLED =
  process.env.NEXT_PUBLIC_AI_ASSISTANT_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_AI_ASSISTANT_ENABLED === "true";

// Whether the BeakerBot image-attachment composer is visible. Default OFF.
// Enable by setting NEXT_PUBLIC_BEAKERBOT_VISION=true in .env.local (or as a
// Vercel plain var). The toggle is in the UI only; the store and the proxy
// route accept images regardless. Set AI_VISION_MODEL on the server side so
// the proxy selects the vision model when image blocks are present.
// When this is false, the attach button, paste-image, drag-and-drop, and the
// thumbnail strip are all absent and behavior is identical to today.
export const BEAKERBOT_VISION_ENABLED =
  process.env.NEXT_PUBLIC_BEAKERBOT_VISION === "true" ||
  process.env.NEXT_PUBLIC_BEAKERBOT_VISION === "1";

// Resumable plan card (2026-06-13). When on, an approved propose_plan is driven
// ONE STEP AT A TIME so the live plan card ticks each step and a stopped plan can
// resume from where it left off. When off, plans free-run exactly as before, so
// this gates the new (riskier) execution path until it is verified. Enable with
// NEXT_PUBLIC_BEAKERBOT_PLAN_STEPS=true in .env.local or a Vercel plain var.
export const BEAKERBOT_PLAN_STEPS_ENABLED =
  process.env.NEXT_PUBLIC_BEAKERBOT_PLAN_STEPS === "true" ||
  process.env.NEXT_PUBLIC_BEAKERBOT_PLAN_STEPS === "1";
