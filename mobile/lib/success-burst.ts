// Global "sent to your lab" success burst trigger. Any successful phone->laptop
// push calls fireSuccess(); the SuccessBurst overlay (mounted once at the app
// root) plays the rainbow-arc + confetti celebration. Fires are COALESCED: a
// fire within COOLDOWN_MS of the last one is ignored, so a bulk batch of many
// uploads shows ONE burst, not one per photo. A success haptic plays when a
// burst actually starts. House style: no em-dashes, no emojis, no mid-sentence
// colons.
import * as Haptics from 'expo-haptics';

export interface SuccessPayload {
  title: string;
  subtitle?: string;
  // Monotonic id so the overlay can restart its animation on each new burst.
  id: number;
}

type Listener = (p: SuccessPayload) => void;

let listeners: Listener[] = [];
let lastFireAt = 0;
let counter = 0;

// The burst is about 1.6s; a slightly longer cooldown coalesces a rapid batch
// (bulk send) into a single celebration.
const COOLDOWN_MS = 1800;

export function subscribeSuccess(cb: Listener): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

export function fireSuccess(opts?: { title?: string; subtitle?: string }): void {
  const now = Date.now();
  if (now - lastFireAt < COOLDOWN_MS) return; // coalesce
  lastFireAt = now;
  counter += 1;

  try {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Haptics unavailable in this runtime, ignore.
  }

  const payload: SuccessPayload = {
    title: opts?.title ?? 'Sent to your lab',
    subtitle: opts?.subtitle,
    id: counter,
  };
  for (const l of listeners) {
    try {
      l(payload);
    } catch {
      // A listener error must never break the send path.
    }
  }
}
