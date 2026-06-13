// Notebook tab: the bench companion. Connection card, quick-capture actions
// (Take a photo / Quick note), and the Today glance (scheduled / overdue /
// coming up / last synced). The photo-capture pipeline and outbox from the old
// Send tab live here too; the outbox section is only shown when there are
// captures so the home stays clean when empty. House style: no em-dashes,
// no emojis, no mid-sentence colons.
//
// Chooser integration (2026-06-09): after a photo or quick note uploads, the
// NotebookChooser sheet opens so the user can file it in any notebook they
// can write to (own, shared-edit, or 1:1). For an experiment context the
// existing Lab Notes / Results Alert remains as the recommended fast path
// (the chooser's RECOMMENDED row surfaces it). For a note context the chooser
// highlights the open note. No context shows a plain chooser. onUnsorted()
// falls back to inbox (no routing command posted).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  LayoutAnimation,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// ScrollView comes from gesture-handler so the per-row swipe-to-delete
// cooperates with vertical scrolling instead of fighting it.
import { Swipeable, ScrollView } from 'react-native-gesture-handler';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { AnnotationOverlay } from '@/components/AnnotationOverlay';
import {
  setAnnotateTarget,
  takeAnnotateResult,
} from '@/lib/annotate-handoff';
import type { AnnotationDoc } from '@/lib/annotations';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useTheme, palette } from '@/lib/design';
import {
  addCapture,
  removeCapture,
  clearAllCaptures,
  sendCapture,
  useCaptures,
  type Capture,
} from '@/lib/captures';
import { usePairing, clearPairing } from '@/lib/pairing';
import { scanNote, isScannerAvailable, type OcrResult } from '@/lib/ocr';
import { setPendingBatch } from '@/lib/bulk-batch';
import { signWithDevice } from '@/lib/device-identity';
import {
  fetchSnapshot,
  type TodaySnapshot,
  type SnapshotTask,
} from '@/lib/snapshots';
import { getFocusContext, type FocusContext } from '@/lib/focus-context';
import { postRouteCapture } from '@/lib/route-capture';
import { fetchNotebooks, type NotebookSummary } from '@/lib/notebooks';
import { postRouteCaptureNote, postAppendNoteText } from '@/lib/note-route';
import { postOcrSidecar } from '@/lib/ocr-sidecar';
import { sendTextNote } from '@/lib/notes';
import { NotebookChooser } from '@/components/NotebookChooser';
import { fireSuccess } from '@/lib/success-burst';
import { useTodayPrefs } from '@/lib/today-prefs';
import { hapticImpact, useReduceMotion } from '@/lib/interaction-prefs';
import {
  DEMO_IMAGE_URI,
  DEMO_SEED_KEY,
  DEMO_NOTIFICATION_TITLE,
  DEMO_NOTIFICATION_BODY,
  DEMO_NOTIF_FIRED_KEY,
} from '@/lib/demo-fixtures';
import { ensureNotificationPermission } from '@/lib/notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function NotebookScreen() {
  const router = useRouter();
  const { surface, spacing, radii } = useTheme();

  // ---- Pairing ----
  const { pairing, refresh: refreshPairing } = usePairing();
  const paired = !!pairing;

  // Keep the connection card current when returning from the pair screen.
  useFocusEffect(
    useCallback(() => {
      refreshPairing();
    }, [refreshPairing]),
  );

  // ---- Today snapshot ----
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  // ---- Today visibility (device-local pref) + collapse state ----
  // showToday gates the whole surface (default on, so existing users keep it).
  // todayExpanded is the in-session pull-down state, expanded by default, so
  // the glance is there on open and one tap on the grab handle tucks it away.
  const [todayPrefs] = useTodayPrefs();
  const [todayExpanded, setTodayExpanded] = useState(true);
  const reduceMotion = useReduceMotion();
  const toggleTodayExpanded = useCallback(() => {
    hapticImpact();
    // A light height animation reads as a pull-down/tuck-away. Skipped under
    // reduce motion so the section just snaps open or closed.
    if (!reduceMotion) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setTodayExpanded((prev) => !prev);
  }, [reduceMotion]);

  // ---- Demo mode side-effects (seeding captures + one-time notification) ----
  // These run once when we first land in demo mode. Guards in AsyncStorage
  // prevent re-seeding or re-firing on repeated tab visits within the same session.
  useEffect(() => {
    if (!pairing?.demo) return;

    // Seed two sample captures into the outbox (idempotent via the seed key).
    void (async () => {
      try {
        const alreadySeeded = await AsyncStorage.getItem(DEMO_SEED_KEY);
        if (!alreadySeeded) {
          await addCapture({ uri: DEMO_IMAGE_URI, caption: 'Demo: Plate 4 brightfield overview (GFP channel)' });
          await addCapture({ uri: DEMO_IMAGE_URI, caption: 'Demo: Post-trypsin cell suspension check' });
          await AsyncStorage.setItem(DEMO_SEED_KEY, '1');
          await refreshCaptures();
        }
      } catch {
        // Seeding is best-effort; the demo still works without it.
      }
    })();

    // Fire one sample local notification (at most once per demo session).
    void (async () => {
      try {
        const alreadyFired = await AsyncStorage.getItem(DEMO_NOTIF_FIRED_KEY);
        if (alreadyFired) return;
        const granted = await ensureNotificationPermission();
        if (!granted) return;
        // Lazy-require matches the pattern in notifications.ts (avoids a hard
        // crash when the module is unavailable, e.g. on web/Expo Go edge).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Notifications = require('expo-notifications') as typeof import('expo-notifications') | null;
        if (!Notifications) return;
        await Notifications.scheduleNotificationAsync({
          content: {
            title: DEMO_NOTIFICATION_TITLE,
            body: DEMO_NOTIFICATION_BODY,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: 4,
            repeats: false,
          },
        });
        await AsyncStorage.setItem(DEMO_NOTIF_FIRED_KEY, '1');
      } catch {
        // Notification is best-effort; demo works without it.
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing?.demo]);

  // Clear demo AsyncStorage flags when unpairing so a fresh demo entry re-seeds.
  const onUnpair = useCallback(async () => {
    await clearPairing();
    // Remove the demo seed + notification guards so they re-arm if the user
    // tries demo again after re-entering the pair screen.
    try {
      await AsyncStorage.multiRemove([DEMO_SEED_KEY, DEMO_NOTIF_FIRED_KEY]);
    } catch {
      // Best-effort cleanup.
    }
    refreshPairing();
  }, [refreshPairing]);

  const loadSnapshot = useCallback(async () => {
    if (!pairing) {
      setSnapshot(null);
      setSnapshotLoaded(true);
      return;
    }
    setSnapshotLoading(true);
    setSnapshotError(null);
    try {
      const data = (await fetchSnapshot(
        'today',
        pairing,
        signWithDevice,
      )) as TodaySnapshot | null;
      setSnapshot(data);
      setSnapshotLoaded(true);
    } catch {
      setSnapshotError('Could not sync. Pull down to try again.');
    } finally {
      setSnapshotLoading(false);
    }
  }, [pairing]);

  const pairingKey = pairing ? `${pairing.u}:${pairing.relayUrl}` : 'none';
  useEffect(() => {
    void loadSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairingKey]);

  // ---- Photo capture pipeline ----
  const { captures, refresh: refreshCaptures } = useCaptures();
  // Automatic retry for failed sends: a failed capture retries itself a couple
  // of times with backoff (reading "Waiting for connection" while it does)
  // before it falls back to a manual "Couldn't send / Retry".
  const retryAttempts = useRef<Map<string, number>>(new Map());
  const retryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<AnnotationDoc | null>(null);
  // OCR layer for a scanned handwriting note (null for plain photos). Rides with
  // the capture so the laptop writes the {image}.ocr.json sidecar.
  const [previewOcr, setPreviewOcr] = useState<OcrResult | null>(null);
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);

  // ---- Notebook chooser ----
  // Notebooks are fetched once per session and cached here. The fetch is
  // triggered lazily when the chooser is needed, so the tab load is unaffected.
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const notebooksFetchedRef = useRef(false);
  const [chooserVisible, setChooserVisible] = useState(false);
  // The capture that is waiting for the user to pick a notebook.
  const [pendingCapture, setPendingCapture] = useState<Capture | null>(null);
  // The focus context fetched alongside the upload.
  const [pendingContext, setPendingContext] = useState<FocusContext | null>(null);

  // ---- Inline quick-note compose (paired path) ----
  // When the device is paired, "Quick note" shows an inline panel here instead
  // of routing to /note, so we can open the chooser after the note uploads.
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  const [quickNoteTitle, setQuickNoteTitle] = useState('');
  const [quickNoteBody, setQuickNoteBody] = useState('');
  const [quickNoteSending, setQuickNoteSending] = useState(false);
  // captureId returned by sendTextNote so the routing command can reference it.
  // sendTextNote does not currently expose the captureId; we store null and
  // postRouteCaptureNote is a no-op for quick notes that have already landed
  // in the inbox before the chooser resolves. The chooser for quick notes
  // therefore does NOT post a route command; it is informational only. We
  // handle this by posting the route command BEFORE sending the note bytes when
  // a notebook is selected (see sendQuickNoteWithRouting).
  const pendingQuickNoteResolveRef = useRef<((notebookInfo: { notebook: NotebookSummary; entryId: string | null } | null) => void) | null>(null);

  useFocusEffect(
    useCallback(() => {
      refreshCaptures();
      // Returning from the annotate editor: take the saved doc and apply it to
      // the preview when it matches the photo currently in preview.
      const result = takeAnnotateResult();
      if (result) {
        setPreviewUri((current) => {
          if (current && current === result.uri) {
            setPreviewDoc(result.doc);
          }
          return current;
        });
      }
    }, [refreshCaptures]),
  );

  const sendOne = useCallback(
    async (capture: Capture, opts?: { suppressBurst?: boolean }) => {
      if (!pairing) return;
      try {
        await sendCapture(capture, pairing, signWithDevice, opts);
      } catch (err) {
        Alert.alert(
          'Upload failed',
          err instanceof Error ? err.message : 'Could not send that capture. Try again.',
        );
      } finally {
        await refreshCaptures();
      }
    },
    [pairing, refreshCaptures],
  );

  const onSendAll = useCallback(async () => {
    if (!pairing || sendingAll) return;
    setSendingAll(true);
    try {
      const pending = captures.filter(
        (c) => c.status === 'queued' || c.status === 'failed',
      );
      for (const capture of pending) {
        try {
          await sendCapture(capture, pairing, signWithDevice);
        } catch {
          // Keep going; failed pill + per-item retry covers this one.
        }
      }
    } finally {
      await refreshCaptures();
      setSendingAll(false);
    }
  }, [pairing, sendingAll, captures, refreshCaptures]);

  const onTakePhoto = useCallback(async () => {
    if (pairing?.demo) {
      // In demo mode there is no real bench camera to route from, so stage the
      // fixture capture directly. This skips the camera and its permission
      // dialog, so the capture-and-route flow is fully deterministic to record.
      setPreviewUri(DEMO_IMAGE_URI);
      setPreviewDoc(null);
      setPreviewOcr(null);
      setCaption('');
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Camera access needed',
        'ResearchOS needs camera access to snap a bench photo. You can turn it on in Settings.',
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    setPreviewUri(asset.uri);
    setPreviewDoc(null);
    setPreviewOcr(null);
    setCaption('');
  }, [pairing?.demo]);

  // Scan a handwritten page. The native document scanner rectifies + cleans it
  // onto a white background and OCRs it on-device, then we stage the enhanced
  // image as the preview with its OCR layer attached. Only available on the dev
  // client (isScannerAvailable is false in Expo Go). Cancel is a silent no-op.
  const onScanNote = useCallback(async () => {
    try {
      const scanned = await scanNote();
      if (!scanned) return;
      setPreviewUri(scanned.uri);
      setPreviewDoc(null);
      setPreviewOcr(scanned.ocr);
      setCaption('');
    } catch (err) {
      Alert.alert(
        'Scan failed',
        err instanceof Error ? err.message : 'Could not scan the note.',
      );
    }
  }, []);

  const onUploadFromLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photos access needed',
        'Allow photo library access to upload from your camera roll. You can turn it on in Settings.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.7,
    });
    if (result.canceled) return;
    const picked = (result.assets ?? []).map((a) => a.uri).filter(Boolean);
    if (picked.length === 0) return;
    if (picked.length === 1) {
      setPreviewUri(picked[0]);
      setPreviewDoc(null);
      setPreviewOcr(null);
      setCaption('');
      return;
    }
    setPendingBatch(picked);
    router.push('/bulk');
  }, [router]);

  // Fetch (or return cached) notebooks list. The first call hits the relay;
  // subsequent calls return the in-memory cache without a round-trip.
  const fetchNotebooksCached = useCallback(async (): Promise<NotebookSummary[]> => {
    if (!pairing) return [];
    if (notebooksFetchedRef.current && notebooks.length > 0) return notebooks;
    try {
      const list = await fetchNotebooks(pairing, signWithDevice);
      setNotebooks(list);
      notebooksFetchedRef.current = true;
      return list;
    } catch {
      // Fetch failed; fall back to empty (chooser will show only unsorted).
      return [];
    }
  }, [pairing, notebooks]);

  // Upload a queued capture and open the NotebookChooser so the user can
  // file it. For an experiment context the existing Lab Notes / Results Alert
  // remains as the recommended fast path surfaced via the chooser's RECOMMENDED
  // row. For no pairing key, or when the fetch fails, fall through silently
  // (inbox upload, same as before this feature landed).
  const sendWithRouting = useCallback(
    async (queued: import('@/lib/captures').Capture) => {
      if (!pairing) return;

      // Fetch the focus context and notebooks list concurrently with the upload.
      const contextPromise = getFocusContext(pairing.relayUrl).catch(() => null);
      const notebooksPromise = fetchNotebooksCached();

      // Suppress the upload-time burst, the celebration fires AFTER the user
      // picks a destination below (so we never animate "sent" before the
      // notebook is chosen).
      await sendOne(queued, { suppressBurst: true });

      // Guard: no routing without an X25519 pubkey (old pairing shape). The
      // capture already landed in the inbox, so confirm that.
      const userX25519PubHex = pairing.userX25519PubHex ?? '';
      if (!userX25519PubHex) {
        fireSuccess({ subtitle: 'Sent to inbox' });
        return;
      }

      // Decoupled OCR. A scanned capture carries its OCR layer on its own sealed
      // command keyed to the captureId, sent now regardless of where it routes,
      // so the laptop writes {image}.ocr.json wherever the image lands (inbox,
      // notebook, or experiment). Plain photos have no ocr, so this is a no-op
      // for them.
      if (queued.ocr) {
        void postOcrSidecar(
          queued.id,
          queued.ocr,
          userX25519PubHex,
          pairing.relayUrl,
        );
      }

      let ctx: FocusContext | null;
      try {
        ctx = await contextPromise;
      } catch {
        fireSuccess({ subtitle: 'Sent to inbox' });
        return;
      }

      // For an experiment context, keep the existing Notes/Results Alert as
      // the fast path. The chooser is also shown (with the experiment as the
      // RECOMMENDED row) so the user can override to any notebook. We use
      // Alert here (matching the existing UX) and skip the full chooser when
      // the user picks via Alert.
      if (ctx?.kind === 'experiment') {
        const { taskId, owner, name } = ctx;
        let routedViaAlert = false;
        await new Promise<void>((resolve) => {
          Alert.alert(
            `Send to ${name}?`,
            'Choose where this photo should appear in your lab notebook.',
            [
              {
                text: 'Lab Notes',
                onPress: () => {
                  routedViaAlert = true;
                  fireSuccess({ subtitle: `Sent to ${name} Lab Notes` });
                  void postRouteCapture(
                    queued.id,
                    taskId,
                    owner,
                    'notes',
                    userX25519PubHex,
                    pairing.relayUrl,
                  ).finally(resolve);
                },
              },
              {
                text: 'Results',
                onPress: () => {
                  routedViaAlert = true;
                  fireSuccess({ subtitle: `Sent to ${name} Results` });
                  void postRouteCapture(
                    queued.id,
                    taskId,
                    owner,
                    'results',
                    userX25519PubHex,
                    pairing.relayUrl,
                  ).finally(resolve);
                },
              },
              {
                text: 'More notebooks...',
                onPress: () => {
                  // Fall through to the full chooser below (it fires its own burst).
                  resolve();
                },
              },
              {
                text: 'Send to inbox instead',
                style: 'cancel',
                onPress: () => {
                  routedViaAlert = true;
                  fireSuccess({ subtitle: 'Sent to inbox' });
                  resolve();
                },
              },
            ],
            {
              cancelable: true,
              onDismiss: () => {
                routedViaAlert = true;
                fireSuccess({ subtitle: 'Sent to inbox' });
                resolve();
              },
            },
          );
        });
        if (routedViaAlert) return;
        // User tapped "More notebooks..." - fall through to full chooser.
      }

      // Open the full NotebookChooser sheet.
      const nbList = await notebooksPromise;
      setNotebooks(nbList);
      notebooksFetchedRef.current = true;
      setPendingCapture(queued);
      setPendingContext(ctx);
      setChooserVisible(true);
    },
    [pairing, sendOne, fetchNotebooksCached],
  );

  // Called when the user picks a notebook in the chooser (photo path).
  const onChooserPickNotebook = useCallback(
    async (notebook: NotebookSummary, entryId: string | null) => {
      setChooserVisible(false);
      if (!pairing || !pendingCapture) return;
      const userX25519PubHex = pairing.userX25519PubHex ?? '';
      if (!userX25519PubHex) return;
      try {
        await postRouteCaptureNote(
          pendingCapture.id,
          notebook.noteId,
          notebook.owner,
          entryId,
          userX25519PubHex,
          pairing.relayUrl,
          // OCR no longer rides the route command; it travels on its own
          // ocr-sidecar command (postOcrSidecar) keyed to the captureId.
        );
        fireSuccess({ subtitle: `Filed in ${notebook.title}` });
      } catch {
        // Best-effort: capture already uploaded, routing is optional.
      }
      setPendingCapture(null);
      setPendingContext(null);
    },
    [pairing, pendingCapture],
  );

  const onChooserUnsorted = useCallback(() => {
    setChooserVisible(false);
    setPendingCapture(null);
    setPendingContext(null);
    // No routing command; capture stays in the inbox. Fire the burst now that
    // the destination (inbox) is chosen.
    fireSuccess({ subtitle: 'Sent to inbox' });
  }, []);

  const onChooserClose = useCallback(() => {
    setChooserVisible(false);
    setPendingCapture(null);
    setPendingContext(null);
  }, []);

  // ---- Quick-note send with routing ----
  // Compose inline, then open the chooser BEFORE sending the note bytes so the
  // captureId from sendTextNote can carry the routing metadata. Because
  // sendTextNote generates its own captureId internally, we route by opening
  // the chooser first, resolving to the chosen notebook, then calling a
  // note-send variant that injects the target via the caption prefix. In
  // practice: show chooser, await pick, send note with "[Notebook: X / Entry:
  // Y]" prepended so the laptop can parse it. The relay ignores the prefix.
  const sendQuickNoteWithRouting = useCallback(async () => {
    if (!pairing || quickNoteBody.trim().length === 0) return;
    setQuickNoteSending(true);
    try {
      const userX25519PubHex = pairing.userX25519PubHex ?? '';

      // Fetch context and notebooks concurrently.
      const contextPromise = getFocusContext(pairing.relayUrl).catch(() => null);
      const nbList = await fetchNotebooksCached();
      const ctx = await contextPromise;
      setNotebooks(nbList);
      notebooksFetchedRef.current = true;

      if (userX25519PubHex && nbList.length > 0) {
        // Show the chooser and wait for the user to pick.
        setPendingContext(ctx ?? null);
        setChooserVisible(true);

        const chosen = await new Promise<{
          notebook: NotebookSummary;
          entryId: string | null;
        } | null>((resolve) => {
          pendingQuickNoteResolveRef.current = resolve;
        });

        setChooserVisible(false);
        setPendingContext(null);

        if (chosen) {
          // Build the text to append. Prepend the title as a markdown heading
          // when the user supplied one, so the note entry gets clean structure.
          const body = quickNoteBody.trim();
          const text = quickNoteTitle.trim()
            ? `## ${quickNoteTitle.trim()}\n\n${body}`
            : body;

          try {
            await postAppendNoteText(
              chosen.notebook.noteId,
              chosen.notebook.owner,
              chosen.entryId,
              text,
              userX25519PubHex,
              pairing.relayUrl,
            );
          } catch {
            // postAppendNoteText is best-effort. If it throws the text is lost
            // from the chosen entry; the user can retry or type it again. We do
            // NOT fall back to inbox here because the user already chose a
            // destination and expects the action to complete silently.
          }
          fireSuccess({ subtitle: `Filed in ${chosen.notebook.title}` });
          setQuickNoteOpen(false);
          setQuickNoteTitle('');
          setQuickNoteBody('');
          return;
        }
        // User chose "unsorted" (resolve(null)) - fall through to plain send.
      }

      // No chooser (no key / no notebooks / user picked unsorted): plain send.
      const result = await sendTextNote(
        { title: quickNoteTitle, body: quickNoteBody.trim() },
        pairing,
        signWithDevice,
      );
      if (result.ok) {
        setQuickNoteOpen(false);
        setQuickNoteTitle('');
        setQuickNoteBody('');
      } else {
        Alert.alert('Note failed', result.error);
      }
    } finally {
      setQuickNoteSending(false);
    }
  }, [pairing, quickNoteTitle, quickNoteBody, fetchNotebooksCached]);

  // Called when the chooser resolves during quick-note flow.
  const onQuickNoteChooserPick = useCallback(
    (notebook: NotebookSummary, entryId: string | null) => {
      const resolve = pendingQuickNoteResolveRef.current;
      pendingQuickNoteResolveRef.current = null;
      resolve?.({ notebook, entryId });
    },
    [],
  );

  const onQuickNoteChooserUnsorted = useCallback(() => {
    const resolve = pendingQuickNoteResolveRef.current;
    pendingQuickNoteResolveRef.current = null;
    resolve?.(null);
  }, []);

  const onQuickNoteChooserClose = useCallback(() => {
    const resolve = pendingQuickNoteResolveRef.current;
    pendingQuickNoteResolveRef.current = null;
    resolve?.(null);
  }, []);

  const onAddToOutbox = useCallback(async () => {
    if (!previewUri) return;
    setSaving(true);
    try {
      const queued = await addCapture({
        uri: previewUri,
        caption,
        // Carry the annotation doc with the queued capture when one was drawn.
        annotation: previewDoc ?? undefined,
        // Carry the OCR layer for a scanned note so the laptop writes the
        // {image}.ocr.json sidecar.
        ocr: previewOcr ?? undefined,
      });
      setPreviewUri(null);
      setPreviewDoc(null);
      setPreviewOcr(null);
      setCaption('');
      await refreshCaptures();
      if (pairing) {
        await sendWithRouting(queued);
      }
    } finally {
      setSaving(false);
    }
  }, [previewUri, previewDoc, previewOcr, caption, refreshCaptures, pairing, sendWithRouting]);

  // Stash the preview photo and open the annotation editor. The doc comes back
  // on focus return (see useFocusEffect above).
  const onAnnotate = useCallback(() => {
    if (!previewUri) return;
    setAnnotateTarget(previewUri);
    router.push('/annotate');
  }, [previewUri, router]);

  const onDiscard = useCallback(() => {
    setPreviewUri(null);
    setPreviewDoc(null);
    setPreviewOcr(null);
    setCaption('');
  }, []);

  const onRemove = useCallback(
    async (id: string) => {
      await removeCapture(id);
      await refreshCaptures();
    },
    [refreshCaptures],
  );

  const onRemoveAll = useCallback(() => {
    Alert.alert(
      'Remove all from Inbox?',
      'This clears the list on your phone. Captures already on your laptop stay there.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove all',
          style: 'destructive',
          onPress: async () => {
            await clearAllCaptures();
            await refreshCaptures();
          },
        },
      ],
    );
  }, [refreshCaptures]);

  // Automatic retry backoff for failed captures. A failed send retries itself
  // up to MAX_AUTO_RETRIES times (reading "Waiting for connection" in between)
  // before it settles into a manual "Couldn't send / Retry".
  useEffect(() => {
    if (!pairing) return;
    const MAX_AUTO_RETRIES = 2;
    captures.forEach((c) => {
      if (c.status === 'sent') {
        retryAttempts.current.delete(c.id);
        return;
      }
      if (c.status !== 'failed') return;
      if (retryTimers.current.has(c.id)) return;
      const attempts = retryAttempts.current.get(c.id) ?? 0;
      if (attempts >= MAX_AUTO_RETRIES) return;
      retryAttempts.current.set(c.id, attempts + 1);
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.add(c.id);
        return next;
      });
      const timer = setTimeout(() => {
        retryTimers.current.delete(c.id);
        void (async () => {
          try {
            await sendOne(c, { suppressBurst: true });
          } catch {
            // Still failed; the effect reschedules until the cap is hit.
          }
          setRetryingIds((prev) => {
            const next = new Set(prev);
            next.delete(c.id);
            return next;
          });
          await refreshCaptures();
        })();
      }, 3000 * (attempts + 1));
      retryTimers.current.set(c.id, timer);
    });
  }, [captures, pairing, sendOne, refreshCaptures]);

  // Clear any pending retry timers on unmount.
  useEffect(() => {
    const timers = retryTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  // ---- Today snapshot data ----
  const tasks: SnapshotTask[] = Array.isArray(snapshot?.tasks)
    ? snapshot!.tasks!
    : [];
  const overdue = typeof snapshot?.overdue === 'number' ? snapshot.overdue : 0;
  const upcoming =
    typeof snapshot?.upcoming === 'number' ? snapshot.upcoming : 0;
  const overdueTasks: SnapshotTask[] = Array.isArray(snapshot?.overdueTasks)
    ? snapshot!.overdueTasks!
    : [];
  const upcomingTasks: SnapshotTask[] = Array.isArray(snapshot?.upcomingTasks)
    ? snapshot!.upcomingTasks!
    : [];

  // Connection gate: until the phone is paired, the Notebook does real work only
  // through the laptop, so it shows nothing but the pair CTA (capture now
  // requires pairing first). Calc / Timers / Wiki stay usable offline. Demo
  // writes a pairing record, so demo users pass straight through. A queued-count
  // line surfaces any captures stranded from before this shipped, so nothing is
  // silently lost.
  if (!paired) {
    const pendingCount = captures.filter(
      (c) => c.status === 'queued' || c.status === 'failed',
    ).length;
    return (
      <ScreenFrame>
        <View style={styles.scrollContent}>
          <View style={styles.titleRow}>
            <ThemedText type="title">Notebook</ThemedText>
            <Pressable
              onPress={() => router.push('/modal')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              style={styles.settingsBtn}
            >
              <Ionicons name="settings-outline" size={24} color={palette.sky} />
            </Pressable>
          </View>
          <Card style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
              Pair this phone
            </ThemedText>
            <ThemedText style={[styles.tagline, { color: surface.muted }]}>
              Pair this phone with your laptop to send captures and notes to your lab.
            </ThemedText>
            <Button
              testID="notebook-pair-cta"
              variant="primary"
              label="Pair this phone"
              onPress={() => router.push('/pair')}
            />
            {pendingCount > 0 ? (
              <ThemedText style={[styles.tagline, { color: surface.muted }]}>
                {pendingCount} capture{pendingCount === 1 ? '' : 's'} queued. Pair to
                send {pendingCount === 1 ? 'it' : 'them'}.
              </ThemedText>
            ) : null}
          </Card>
        </View>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={snapshotLoading}
            onRefresh={loadSnapshot}
            tintColor={palette.sky}
          />
        }
      >
        <View style={styles.titleRow}>
          <ThemedText type="title">Notebook</ThemedText>
          <View style={styles.headerActions}>
            <Pressable
              testID="notebook-notifications"
              onPress={() => router.push('/notifications')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              style={styles.settingsBtn}
            >
              <Ionicons name="notifications-outline" size={23} color={palette.sky} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/modal')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              style={styles.settingsBtn}
            >
              <Ionicons name="settings-outline" size={24} color={palette.sky} />
            </Pressable>
          </View>
        </View>
        <ThemedText style={[styles.tagline, { color: surface.muted }]}>
          {todayPrefs.showToday
            ? 'Capture the bench into your lab notebook, and see what is on today.'
            : 'Capture the bench into your lab notebook.'}
        </ThemedText>

        {/* Demo mode pill: persistent sky-accent banner so sample data is
            obvious. Only shown when the demo pairing is active. Unpair exits. */}
        {pairing?.demo ? (
          <View
            style={[
              styles.demoPill,
              { backgroundColor: palette.skyDim, borderColor: palette.skyBorder },
            ]}
          >
            <View style={styles.demoPillDot} />
            <ThemedText style={[styles.demoPillText, { color: palette.sky }]}>
              Demo mode
            </ThemedText>
            <ThemedText style={[styles.demoPillSub, { color: palette.sky }]}>
              Sample data only. Tap Unpair to exit.
            </ThemedText>
          </View>
        ) : null}

        {/* Connection card (always paired here, the gate above handles unpaired) */}
        <ConnectionCard
          labName={pairing?.labName ?? 'Paired with your lab'}
          onUnpair={onUnpair}
        />

        {/* Today pull-down (top of the tab, expanded by default). The grab
            handle plus chevron tucks the glance away for a lean bench, and the
            Settings "Show Today" toggle removes it entirely. Only shown when
            paired, since the today snapshot comes from the laptop. Hidden
            entirely when the pref is off, so the app is unchanged. */}
        {pairing && todayPrefs.showToday ? (
          <View style={styles.todaySection}>
            <Pressable
              onPress={toggleTodayExpanded}
              accessibilityRole="button"
              accessibilityState={{ expanded: todayExpanded }}
              accessibilityLabel={
                todayExpanded ? 'Hide Today' : 'Show Today'
              }
              style={({ pressed }) => [
                styles.todayHandleWrap,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              {/* Grab handle bar, the pull-down affordance. */}
              <View style={[styles.todayGrab, { backgroundColor: surface.border }]} />
              <View style={styles.todayHeaderRow}>
                <View style={styles.todayHeaderLeft}>
                  <View style={styles.todayBadge}>
                    <Ionicons name="today-outline" size={15} color={palette.white} />
                  </View>
                  <ThemedText style={[styles.todayTitle, { color: surface.text }]}>
                    Today
                  </ThemedText>
                  {overdue > 0 ? (
                    <View style={styles.todayOverduePill}>
                      <ThemedText style={styles.todayOverduePillText}>
                        {overdue} overdue
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
                <Ionicons
                  name={todayExpanded ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={surface.muted}
                />
              </View>
            </Pressable>

            {todayExpanded ? (
              <View style={styles.todayBody}>
                {snapshotError ? (
                  <View
                    style={[
                      styles.errorBanner,
                      {
                        borderColor: palette.dangerBorder,
                        backgroundColor: palette.dangerLight,
                        borderRadius: 12,
                      },
                    ]}
                  >
                    <ThemedText style={[styles.errorText, { color: palette.danger }]}>
                      {snapshotError}
                    </ThemedText>
                  </View>
                ) : null}

                {snapshotLoading && !snapshotLoaded ? (
                  <View style={styles.loadingWrap}>
                    <ActivityIndicator color={palette.sky} />
                  </View>
                ) : null}

                {snapshotLoaded && snapshot === null && !snapshotError ? (
                  <Card>
                    <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
                      Not synced yet
                    </ThemedText>
                    <ThemedText style={[styles.tagline, { color: surface.muted }]}>
                      Open ResearchOS on your laptop to sync today.
                    </ThemedText>
                  </Card>
                ) : null}

                {snapshotLoaded && snapshot !== null && !snapshotError ? (
                  <>
                    {tasks.length > 0 ? (
                      tasks.map((task, i) => (
                        <TaskRow key={task.id ?? `today-${i}`} task={task} />
                      ))
                    ) : (
                      <EmptyState
                        icon="calendar-outline"
                        text="Nothing scheduled for today."
                      />
                    )}

                    {overdueTasks.length > 0 ? (
                      <>
                        <SectionHeader title={`Overdue (${overdue})`} />
                        {overdueTasks.map((task, i) => (
                          <TaskRow key={task.id ?? `overdue-${i}`} task={task} overdue />
                        ))}
                      </>
                    ) : overdue > 0 ? (
                      <ThemedText style={[styles.emptyLine, { color: palette.danger }]}>
                        {overdue} overdue
                      </ThemedText>
                    ) : null}

                    {upcomingTasks.length > 0 ? (
                      <>
                        <SectionHeader title={`Coming up (${upcoming})`} />
                        {upcomingTasks.map((task, i) => (
                          <TaskRow key={task.id ?? `upcoming-${i}`} task={task} />
                        ))}
                      </>
                    ) : upcoming > 0 ? (
                      <ThemedText style={[styles.emptyLine, { color: surface.muted }]}>
                        {upcoming} upcoming
                      </ThemedText>
                    ) : null}
                  </>
                ) : null}

                {snapshot?.generatedAt ? (
                  <ThemedText style={[styles.synced, { color: surface.muted }]}>
                    Last synced {formatSynced(snapshot.generatedAt)}
                  </ThemedText>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Quick-capture action row (per mockup: side-by-side icon-over-label cards) */}
        {!previewUri ? (
          <View style={styles.actionRow}>
            <Pressable
              testID="notebook-take-photo"
              onPress={onTakePhoto}
              style={({ pressed }) => [
                styles.actionCard,
                styles.actionPrimary,
                { borderRadius: radii.lg, opacity: pressed ? 0.88 : 1 },
              ]}
              accessibilityRole="button"
            >
              <Ionicons name="camera-outline" size={24} color={palette.white} />
              <ThemedText style={styles.actionLabel}>Take a photo</ThemedText>
            </Pressable>
            <Pressable
              testID="notebook-quick-note"
              onPress={() => {
                if (pairing) {
                  // Paired: show inline compose so we can open the chooser.
                  setQuickNoteOpen(true);
                } else {
                  router.push('/note');
                }
              }}
              style={({ pressed }) => [
                styles.actionCard,
                styles.actionTinted,
                { borderRadius: radii.lg, opacity: pressed ? 0.88 : 1 },
              ]}
              accessibilityRole="button"
            >
              <Ionicons name="create-outline" size={24} color={palette.white} />
              <ThemedText style={styles.actionLabel}>Quick note</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {/* Scan a handwritten note. Elevated to a flagship card because reading
            a paper page into searchable text is the headline reason to capture
            from the phone, not one option buried in a button list. The native
            scanner cleans the page onto a white background and OCRs it on
            device. Dev client only, hidden in Expo Go via isScannerAvailable. */}
        {!previewUri && !quickNoteOpen && isScannerAvailable() ? (
          <Pressable
            testID="notebook-scan-note"
            onPress={onScanNote}
            accessibilityRole="button"
            accessibilityLabel="Scan a handwritten note"
            style={({ pressed }) => [
              styles.scanCard,
              { borderRadius: radii.lg, opacity: pressed ? 0.92 : 1 },
            ]}
          >
            <View style={styles.scanIconTile}>
              <Ionicons name="scan-outline" size={24} color={palette.white} />
            </View>
            <View style={styles.scanCardText}>
              <ThemedText style={styles.scanCardTitle}>
                Scan a handwritten note
              </ThemedText>
              <ThemedText style={styles.scanCardSub}>
                Turn a paper page into searchable text. Cleaned and read on your
                device.
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={palette.skyBorder} />
          </Pressable>
        ) : null}

        {/* Camera roll upload (below action row, no preview yet) */}
        {!previewUri && !quickNoteOpen ? (
          <Button
            testID="notebook-upload-roll"
            variant="secondary"
            accent="amber"
            label="Upload from camera roll"
            onPress={onUploadFromLibrary}
          />
        ) : null}

        {/* View method on phone (read-mode protocol viewer). Opens the focused
            experiment's method, published from the laptop, so the researcher can
            follow the recipe at the bench and jot variations. */}
        {!previewUri && !quickNoteOpen && pairing ? (
          <Button
            testID="notebook-view-method"
            variant="secondary"
            accent="sky"
            label="View method on phone"
            onPress={() => router.push('/method')}
          />
        ) : null}

        {/* Inline quick-note compose panel (paired path, shows chooser on send) */}
        {quickNoteOpen ? (
          <Card style={{ gap: spacing.md }}>
            <TextInput
              testID="notebook-quicknote-title"
              value={quickNoteTitle}
              onChangeText={setQuickNoteTitle}
              placeholder="Title, optional"
              placeholderTextColor={surface.placeholder}
              style={[
                styles.input,
                {
                  backgroundColor: surface.surface,
                  borderColor: surface.border,
                  borderRadius: radii.md,
                  color: surface.text,
                },
              ]}
              editable={!quickNoteSending}
              returnKeyType="next"
            />
            <TextInput
              testID="notebook-quicknote-body"
              value={quickNoteBody}
              onChangeText={setQuickNoteBody}
              placeholder="Write your note"
              placeholderTextColor={surface.placeholder}
              style={[
                styles.input,
                styles.inputTall,
                {
                  backgroundColor: surface.surface,
                  borderColor: surface.border,
                  borderRadius: radii.md,
                  color: surface.text,
                },
              ]}
              editable={!quickNoteSending}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <Button
              testID="notebook-quicknote-send"
              variant="primary"
              label="Send to lab"
              loading={quickNoteSending}
              onPress={sendQuickNoteWithRouting}
              disabled={quickNoteSending || quickNoteBody.trim().length === 0}
            />
            <Button
              variant="secondary"
              accent="coral"
              label="Discard"
              onPress={() => {
                setQuickNoteOpen(false);
                setQuickNoteTitle('');
                setQuickNoteBody('');
              }}
              disabled={quickNoteSending}
            />
          </Card>
        ) : null}

        {/* Photo preview + caption + queue */}
        {previewUri ? (
          <Card style={{ gap: spacing.md }}>
            {/* The image and the annotation overlay both letterbox the same way
                (contain + the SVG viewBox's default xMidYMid meet) so committed
                shapes land exactly where they were drawn. */}
            <View testID="notebook-photo-preview" style={[styles.preview, { borderRadius: radii.md, overflow: 'hidden' }]}>
              <Image
                source={{ uri: previewUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
              />
              {previewDoc ? <AnnotationOverlay doc={previewDoc} /> : null}
            </View>
            <TextInput
              testID="notebook-caption-input"
              value={caption}
              onChangeText={setCaption}
              placeholder="Add a caption, optional"
              placeholderTextColor={surface.placeholder}
              style={[
                styles.input,
                {
                  backgroundColor: surface.surface,
                  borderColor: surface.border,
                  borderRadius: radii.md,
                  color: surface.text,
                },
              ]}
              editable={!saving}
              multiline
            />
            <Button
              testID="notebook-annotate"
              variant="secondary"
              accent="amber"
              label={previewDoc ? 'Edit annotations' : 'Annotate'}
              icon={<Ionicons name="brush-outline" size={18} color={palette.amber} />}
              onPress={onAnnotate}
              disabled={saving}
            />
            <Button
              testID="notebook-send-to-inbox"
              variant="primary"
              label="Send to Inbox"
              loading={saving}
              onPress={onAddToOutbox}
              disabled={saving}
            />
            <Button
              testID="notebook-discard"
              variant="secondary"
              accent="coral"
              label="Discard"
              onPress={onDiscard}
              disabled={saving}
            />
          </Card>
        ) : null}

        {/* Inbox (only shown when there are captures). Captures sync to the
            lab inbox automatically; the header keeps small bulk conveniences. */}
        {captures.length > 0 ? (
          <View style={styles.inboxSection}>
            <View style={styles.inboxHeaderRow}>
              <View style={styles.inboxTitleGroup}>
                <View style={styles.inboxBadge}>
                  <Ionicons name="file-tray-full" size={16} color={palette.white} />
                </View>
                <ThemedText style={[styles.inboxTitle, { color: surface.text }]}>
                  Inbox
                </ThemedText>
              </View>
              <View style={styles.inboxActions}>
                {paired &&
                captures.some(
                  (c) => c.status === 'queued' || c.status === 'failed',
                ) ? (
                  <Pressable
                    testID="notebook-inbox-send-all"
                    onPress={onSendAll}
                    disabled={sendingAll}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <ThemedText style={[styles.inboxAction, { color: palette.sky }]}>
                      Send all
                    </ThemedText>
                  </Pressable>
                ) : null}
                <Pressable testID="notebook-inbox-remove-all" onPress={onRemoveAll} hitSlop={8} accessibilityRole="button">
                  <ThemedText style={[styles.inboxAction, { color: palette.coral }]}>
                    Remove all
                  </ThemedText>
                </Pressable>
              </View>
            </View>
            <ThemedText style={[styles.inboxHelper, { color: surface.muted }]}>
              Captures sync to your lab inbox automatically.
            </ThemedText>
            <View style={[styles.inboxGroup, { backgroundColor: surface.surface }]}>
              {captures.map((capture, i) => (
                <CaptureRow
                  key={capture.id}
                  testID={`notebook-inbox-row-${i}`}
                  capture={capture}
                  onRemove={onRemove}
                  onSend={paired ? sendOne : undefined}
                  isLast={i === captures.length - 1}
                  retrying={retryingIds.has(capture.id)}
                />
              ))}
            </View>
          </View>
        ) : null}

      </ScrollView>

      {/* NotebookChooser sheet (photo path) */}
      {pendingCapture ? (
        <NotebookChooser
          visible={chooserVisible}
          notebooks={notebooks}
          recommended={pendingContext}
          onPickNotebook={onChooserPickNotebook}
          onUnsorted={onChooserUnsorted}
          onClose={onChooserClose}
        />
      ) : null}

      {/* NotebookChooser sheet (quick-note path) */}
      {quickNoteOpen && pendingQuickNoteResolveRef.current ? (
        <NotebookChooser
          visible={chooserVisible}
          notebooks={notebooks}
          recommended={pendingContext}
          onPickNotebook={onQuickNoteChooserPick}
          onUnsorted={onQuickNoteChooserUnsorted}
          onClose={onQuickNoteChooserClose}
        />
      ) : null}
    </ScreenFrame>
  );
}

// Connection card: shows lab name + Unpair when paired.
function ConnectionCard({
  labName,
  onUnpair,
}: {
  labName: string;
  onUnpair: () => void;
}) {
  const { surface } = useTheme();
  return (
    <View style={styles.connCard}>
      <View style={styles.connBadge}>
        <Ionicons name="checkmark" size={16} color={palette.white} />
      </View>
      <View style={styles.connText}>
        <ThemedText style={[styles.connName, { color: surface.text }]}>
          {labName}
        </ThemedText>
        <ThemedText style={[styles.connSub, { color: surface.muted }]}>
          Connected
        </ThemedText>
      </View>
      <Pressable onPress={onUnpair} hitSlop={8} accessibilityRole="button">
        <ThemedText style={[styles.unpairLabel, { color: palette.sky }]}>
          Unpair
        </ThemedText>
      </Pressable>
    </View>
  );
}

function TaskRow({ task, overdue }: { task: SnapshotTask; overdue?: boolean }) {
  const { surface } = useTheme();
  const meta = [formatDateRange(task.start_date, task.end_date), task.task_type]
    .filter((part): part is string => !!part && part.length > 0)
    .join('  -  ');
  return (
    <Card compact>
      <ThemedText
        style={[
          styles.rowTitle,
          { color: overdue ? palette.danger : surface.text },
        ]}
        numberOfLines={2}
      >
        {task.name && task.name.length > 0 ? task.name : 'Untitled task'}
      </ThemedText>
      {meta.length > 0 ? (
        <ThemedText style={[styles.rowMeta, { color: surface.muted }]}>{meta}</ThemedText>
      ) : null}
    </Card>
  );
}

// A single capture row inside the grouped Inbox container. The row reports
// its own status (Sending / On your laptop / Couldn't send); a per-row action
// appears only on a real failure (Retry). Single-row delete is a small muted
// Remove for now; swipe-to-delete lands in the next pass.
function CaptureRow({
  capture,
  onRemove,
  onSend,
  isLast,
  retrying,
  testID,
}: {
  capture: Capture;
  onRemove: (id: string) => void;
  onSend?: (capture: Capture) => void;
  isLast?: boolean;
  // True while a failed capture is in its automatic-retry backoff, so the row
  // reads "Waiting for connection" instead of "Couldn't send".
  retrying?: boolean;
  testID?: string;
}) {
  const { surface, radii } = useTheme();
  const sent = capture.status === 'sent';
  const sending = capture.status === 'sending' || capture.status === 'queued';
  const waiting = capture.status === 'failed' && !!retrying;
  const failed = capture.status === 'failed' && !retrying;
  const canRetry = !!onSend && failed;

  const renderRightActions = () => (
    <Pressable
      onPress={() => onRemove(capture.id)}
      style={styles.swipeDelete}
      accessibilityRole="button"
      accessibilityLabel="Delete capture"
    >
      <Ionicons name="trash-outline" size={20} color={palette.white} />
      <ThemedText style={styles.swipeDeleteLabel}>Delete</ThemedText>
    </Pressable>
  );

  return (
    <Swipeable renderRightActions={renderRightActions} overshootRight={false}>
      <View
        testID={testID}
        style={[
          styles.inboxRow,
          { backgroundColor: surface.surface },
          !isLast && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: surface.border,
          },
        ]}
      >
        <Image
          source={{ uri: capture.uri }}
          style={[styles.inboxThumb, { borderRadius: radii.sm }]}
        />
        <View style={styles.inboxRowBody}>
          <ThemedText
            style={[styles.inboxRowTitle, { color: surface.text }]}
            numberOfLines={2}
          >
            {capture.caption.length > 0 ? capture.caption : 'No caption'}
          </ThemedText>
          <View style={styles.inboxStatusRow}>
            {sending ? (
              <>
                <ActivityIndicator size="small" color={palette.sky} />
                <ThemedText style={[styles.inboxStatus, { color: palette.sky }]}>
                  Sending...
                </ThemedText>
              </>
            ) : sent ? (
              <>
                <Ionicons name="checkmark-circle" size={16} color={palette.success} />
                <ThemedText style={[styles.inboxStatus, { color: palette.success }]}>
                  On your laptop
                </ThemedText>
              </>
            ) : waiting ? (
              <>
                <Ionicons name="time-outline" size={15} color={palette.warning} />
                <ThemedText style={[styles.inboxStatus, { color: palette.warning }]}>
                  Waiting for connection
                </ThemedText>
              </>
            ) : (
              <>
                <View style={styles.failDot} />
                <ThemedText style={[styles.inboxStatus, { color: palette.danger }]}>
                  Couldn&apos;t send
                </ThemedText>
              </>
            )}
            {canRetry ? (
              <View style={styles.inboxRowActions}>
                <Pressable
                  onPress={() => onSend?.(capture)}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <ThemedText style={[styles.inboxAction, { color: palette.sky }]}>
                    Retry
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Swipeable>
  );
}

function formatDateRange(start?: string, end?: string): string {
  const s = formatShortDate(start);
  const e = formatShortDate(end);
  if (s && e) return s === e ? s : `${s} to ${e}`;
  return s || e || '';
}

function formatShortDate(value?: string): string {
  if (!value) return '';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatSynced(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 14,
  },
  tagline: { lineHeight: 22 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginRight: -6,
  },
  settingsBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '700', lineHeight: 22 },

  // Connection card (compact pill matching the mockup).
  connCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    shadowColor: '#101828',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  connBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: palette.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connText: { flex: 1 },
  connName: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  connSub: { fontSize: 12, lineHeight: 18 },
  unpairLabel: { fontSize: 13, fontWeight: '600' },

  // Quick-capture action row
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionCard: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 9,
  },
  actionPrimary: {
    backgroundColor: palette.sky,
  },
  actionTinted: {
    // Coral partner to the sky photo card: high contrast, on-brand highlight.
    backgroundColor: palette.coral,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.white,
    textAlign: 'center',
  },

  // Photo preview
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: '#000000',
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
    textAlignVertical: 'top',
  },
  inputTall: {
    minHeight: 160,
  },

  // Capture rows
  // Inbox section (captures grouped in one colorful container)
  inboxSection: { gap: 8 },
  inboxHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  inboxTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  inboxBadge: {
    width: 27,
    height: 27,
    borderRadius: 8,
    backgroundColor: palette.sky,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: palette.sky,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 2,
  },
  inboxTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.2 },
  inboxActions: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  inboxAction: { fontSize: 13, fontWeight: '700' },
  inboxHelper: { fontSize: 12, lineHeight: 16, paddingHorizontal: 2, marginTop: -2 },
  inboxGroup: {
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#101828',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  inboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  inboxThumb: { width: 46, height: 46, backgroundColor: '#0e1626' },
  inboxRowBody: { flex: 1, gap: 5 },
  inboxRowTitle: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  inboxStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  inboxStatus: { fontSize: 12.5, fontWeight: '600' },
  inboxRowActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  inboxRemove: { fontSize: 12.5, fontWeight: '600' },
  failDot: { width: 9, height: 9, borderRadius: 999, backgroundColor: palette.danger },
  swipeDelete: {
    backgroundColor: palette.danger,
    justifyContent: 'center',
    alignItems: 'center',
    width: 84,
    gap: 3,
  },
  swipeDeleteLabel: { color: palette.white, fontSize: 12, fontWeight: '700' },

  // Today pull-down
  todaySection: { gap: 10 },
  todayHandleWrap: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 14,
    gap: 8,
    shadowColor: '#101828',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  todayGrab: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
  },
  todayHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  todayHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  todayBadge: {
    width: 27,
    height: 27,
    borderRadius: 8,
    backgroundColor: palette.sky,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.2 },
  todayOverduePill: {
    backgroundColor: palette.dangerLight,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  todayOverduePillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: palette.danger,
  },
  todayBody: { gap: 14 },

  // Scan flagship card
  scanCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: palette.skyDim,
    borderWidth: 1,
    borderColor: palette.skyBorder,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  scanIconTile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: palette.sky,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: palette.sky,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 2,
  },
  scanCardText: { flex: 1, gap: 3 },
  scanCardTitle: { fontSize: 15.5, fontWeight: '800', color: palette.sky, letterSpacing: -0.2 },
  scanCardSub: { fontSize: 12.5, lineHeight: 17, color: palette.sky, opacity: 0.85 },

  // Today glance
  emptyLine: { lineHeight: 20 },
  loadingWrap: { paddingVertical: 24, alignItems: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  rowMeta: { fontSize: 13, lineHeight: 18 },
  synced: { fontSize: 12, marginTop: 4 },
  errorBanner: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  errorText: { lineHeight: 20 },

  // Demo mode pill
  demoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  demoPillDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: palette.sky,
  },
  demoPillText: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  demoPillSub: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 18,
    flex: 1,
    opacity: 0.85,
  },
});
