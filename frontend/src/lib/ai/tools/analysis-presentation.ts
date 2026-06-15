// Per-turn presentation latch for BeakerBot Data Hub run tools (BeakerAI lane,
// 2026-06-15).
//
// When a Data Hub analysis or graph runs from the inline AnalysisPickerWidget,
// the result must STAY IN CHAT (no navigation), so the inline picker interaction
// is not yanked off to /datahub. A directly-typed "run a t-test on Control vs
// Drug" still navigates to the stored result sheet (Grant's locked nuance, only
// the picker-driven run stays in chat). Both paths run the SAME tool, so the
// intent is carried out of band here: the conversation store arms this latch for
// the one turn the picker initiates, and each run tool consults it instead of
// always navigating.
//
// Scope is exactly one turn. send() sets it at the top of every turn it starts
// (false unless the picker initiated that turn), so a later typed run can never
// inherit a picker's in-chat intent.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

let resultInChat = false;

/**
 * Arm (true) or disarm (false) in-chat result presentation for the current turn.
 * The conversation store calls this at the top of every turn it starts, passing
 * true only when the turn was initiated by the inline analysis/graph picker.
 */
export function setAnalysisResultInChat(on: boolean): void {
  resultInChat = on === true;
}

/**
 * True when the current turn's analysis or graph run should show its result IN
 * CHAT (skip the navigation to /datahub). Read by the run tools' execute right
 * before they would navigate. Defaults false, so an un-armed (typed) run still
 * navigates to the stored result.
 */
export function analysisResultInChat(): boolean {
  return resultInChat;
}
