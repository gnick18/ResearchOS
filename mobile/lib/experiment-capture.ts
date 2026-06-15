// Capture a bench photo and route it straight to a SPECIFIC experiment's notes
// or results tab. Unlike the Notebook tab (which routes to whatever experiment
// the laptop currently has focused, via getFocusContext), this targets the
// experiment the caller names, so the experiment hub can add to its own notes /
// results regardless of laptop focus. Reuses the same primitives the Notebook
// tab uses: addCapture (queue) -> sendCapture (upload) -> postRouteCapture
// (sealed route command the laptop poller already handles).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import * as ImagePicker from 'expo-image-picker';

import { addCapture, sendCapture } from '@/lib/captures';
import { postRouteCapture, type RouteTab } from '@/lib/route-capture';
import { signWithDevice } from '@/lib/device-identity';
import type { Pairing } from '@/lib/pairing';

export type CaptureToExperimentResult =
  // Captured, uploaded, and the route command was sent (laptop will file it).
  | 'routed'
  // Captured + queued, but this phone is not paired, so it stays in the outbox.
  | 'queued-offline'
  // Uploaded to the inbox, but the pairing has no X25519 key so it cannot be
  // routed to the experiment (old pairing shape).
  | 'sent-no-routing'
  // User backed out of the camera.
  | 'cancelled'
  // Camera permission denied.
  | 'no-permission';

/** Take a photo and route it to {taskId}'s {tab} tab for {owner}. */
export async function captureToExperiment(args: {
  taskId: number;
  owner: string;
  tab: RouteTab;
  pairing: Pairing | null;
  caption?: string;
}): Promise<CaptureToExperimentResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return 'no-permission';

  const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
  if (result.canceled || !result.assets?.[0]) return 'cancelled';

  const queued = await addCapture({
    uri: result.assets[0].uri,
    caption: args.caption ?? '',
  });

  // Not paired: the capture sits in the outbox and flushes on reconnect.
  if (!args.pairing) return 'queued-offline';

  // Upload first (the route command references the uploaded captureId). Suppress
  // the upload burst so the caller owns the success feedback.
  await sendCapture(queued, args.pairing, signWithDevice, { suppressBurst: true });

  const userX25519PubHex = args.pairing.userX25519PubHex ?? '';
  if (!userX25519PubHex) return 'sent-no-routing';

  await postRouteCapture(
    queued.id,
    args.taskId,
    args.owner,
    args.tab,
    userX25519PubHex,
    args.pairing.relayUrl,
  );
  return 'routed';
}
