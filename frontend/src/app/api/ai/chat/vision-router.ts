// Vision router pure helpers (BeakerBot vision, 2026-06-13).
//
// These two functions are the only pure-logic pieces of the vision routing
// feature. They live in their own file so unit tests can import them without
// pulling in next-auth or any other Next.js server modules. route.ts imports
// them from here.
//
// Router design:
//   - Text-only turn -> textModel (AI_MODEL env).
//   - Turn with any image_url block AND AI_VISION_MODEL is set -> visionModel.
//   - Turn with any image_url block BUT AI_VISION_MODEL is unset -> textModel
//     (safe fallback; the feature is inert until Grant sets the env var, and
//     no image is ever sent to a model that has not been configured).
//
// The env var name is AI_VISION_MODEL (no NEXT_PUBLIC_ prefix, server-only).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

// The content shape the router inspects. A local alias that mirrors the
// ChatMessage type in route.ts; we accept the minimal shape we need rather
// than re-exporting the full type, so this module stays free of route.ts
// dependencies.
export type RouterMessage = {
  role: string;
  content:
    | string
    | Array<{ type: string; [key: string]: unknown }>
    | null
    | undefined;
};

/** Returns true when any message in the array contains at least one image_url
 *  content block. A string or null content value is never counted as an image.
 *  Called by selectModel to decide which model endpoint to call. Pure, no side
 *  effects, safe to call in any environment. */
export function hasImageContent(messages: RouterMessage[]): boolean {
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block.type === "image_url") return true;
    }
  }
  return false;
}

/** Pick the model id based on whether the turn carries image content.
 *
 *  Routing table:
 *    - image present AND visionModel non-empty -> visionModel
 *    - image present AND visionModel empty/unset -> textModel (safe fallback)
 *    - no image -> textModel
 *
 *  Pure, no side effects, no env reads. The caller (route.ts) reads the env
 *  vars and passes them in so this function stays testable in isolation. */
export function selectModel(
  messages: RouterMessage[],
  opts: { textModel: string; visionModel: string | undefined },
): string {
  const { textModel, visionModel } = opts;
  if (hasImageContent(messages) && visionModel && visionModel.length > 0) {
    return visionModel;
  }
  return textModel;
}
