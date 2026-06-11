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
