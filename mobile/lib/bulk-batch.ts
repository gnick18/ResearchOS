// Hand-off holder for a camera-roll batch between the Send tab and the bulk
// label screen. The image picker returns many local uris at once; rather than
// cram them into route params (length-limited and ugly), we stash the batch here
// and the bulk screen takes it on mount. The flow is immediate (pick -> navigate
// -> consume) so a module-level holder is enough. House style: no em-dashes, no
// emojis, no mid-sentence colons.
let pending: string[] = [];

export function setPendingBatch(uris: string[]): void {
  pending = uris;
}

// Return the pending batch and clear it, so a back-and-forward navigation does
// not re-open a stale batch.
export function takePendingBatch(): string[] {
  const batch = pending;
  pending = [];
  return batch;
}
