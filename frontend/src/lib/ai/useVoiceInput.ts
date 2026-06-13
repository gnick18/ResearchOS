// useVoiceInput -- voice dictation hook for the BeakerBot composer
// (BeakerAI lane, 2026-06-13).
//
// Wraps the browser Web Speech API (SpeechRecognition / webkitSpeechRecognition)
// so the caller never touches the API directly. The hook exposes:
//
//   supported  -- false when the API is not available (Brave, Firefox, older
//                 Safari); the mic button is hidden in this case.
//   listening  -- true while the recognition session is active.
//   start()    -- opens a new session; no-op when already listening.
//   stop()     -- stops the current session; no-op when not listening.
//   transcript -- the latest committed (non-interim) fragment delivered by the
//                 API. The caller appends it to the existing draft via
//                 appendTranscript() (the pure helper below).
//
// Configuration:
//   continuous     = true   -- keep recording after each result (bench use).
//   interimResults = true   -- fire onresult for partial results too; the hook
//                              only forwards FINAL results (resultIndex where
//                              isFinal === true) to the callback.
//   lang           = ''     -- empty string inherits the browser/OS language.
//
// Lifecycle:
//   The hook cleans up (stops + nulls the SR instance) on unmount so there is
//   no dangling audio stream if the composer unmounts while listening.
//   onend / onerror both clear the listening flag so the UI stays consistent.
//
// The pure helper appendTranscript() is exported separately so it can be
// unit-tested without jsdom or the SpeechRecognition object.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Pure helper: merge a new final transcript fragment into an existing draft.
//
// Rules:
//   - If draft is empty after trim, return the trimmed transcript.
//   - Otherwise join with a single space (no double-space).
//   - Trim both sides before joining so accidental leading/trailing whitespace
//     from the SR engine never bleeds into the draft.
// ---------------------------------------------------------------------------

export function appendTranscript(draft: string, newText: string): string {
  const trimmedDraft = draft.trimEnd();
  const trimmedNew = newText.trim();
  if (!trimmedNew) return draft;
  if (!trimmedDraft) return trimmedNew;
  return `${trimmedDraft} ${trimmedNew}`;
}

// ---------------------------------------------------------------------------
// SpeechRecognition type shim.
// The Web Speech API is not in the standard TypeScript lib (it lives in an
// unofficial spec), so we type just enough to keep the hook typesafe.
// ---------------------------------------------------------------------------

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSRConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  // Cast through unknown to satisfy TS: the globals exist at runtime on
  // supported browsers but are not in the lib.dom.d.ts typings.
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

// ---------------------------------------------------------------------------
// useVoiceInput hook.
// ---------------------------------------------------------------------------

export interface UseVoiceInputResult {
  /** False when SpeechRecognition is not available; hide the mic button. */
  supported: boolean;
  /** True while a recognition session is active. */
  listening: boolean;
  /** Start dictation. No-op when already listening or not supported. */
  start: () => void;
  /** Stop dictation. No-op when not listening. */
  stop: () => void;
}

/**
 * useVoiceInput
 *
 * @param onFinalTranscript - Called with each committed (final) transcript
 *   fragment. The caller is responsible for merging it into the draft via
 *   appendTranscript(). This callback is memoised by the caller.
 */
export function useVoiceInput(
  onFinalTranscript: (text: string) => void,
): UseVoiceInputResult {
  const SRC = getSRConstructor();
  const supported = SRC !== undefined;

  const [listening, setListening] = useState(false);
  const srRef = useRef<SpeechRecognitionInstance | null>(null);

  // Keep a stable ref to the callback so the onresult handler inside the SR
  // instance always calls the latest version without needing to recreate the SR.
  const callbackRef = useRef(onFinalTranscript);
  useEffect(() => {
    callbackRef.current = onFinalTranscript;
  });

  const stop = useCallback(() => {
    if (srRef.current) {
      srRef.current.stop();
      srRef.current = null;
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!SRC || srRef.current) return;

    const sr = new SRC();
    sr.continuous = true;
    sr.interimResults = true;
    sr.lang = "";

    sr.onresult = (ev: SpeechRecognitionEvent) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (result.isFinal) {
          const text = result[0].transcript;
          callbackRef.current(text);
        }
      }
    };

    sr.onend = () => {
      // onend fires when the session closes for any reason (stop, timeout,
      // network hiccup). Always clear the flag so the UI is consistent.
      srRef.current = null;
      setListening(false);
    };

    sr.onerror = () => {
      srRef.current = null;
      setListening(false);
    };

    srRef.current = sr;
    sr.start();
    setListening(true);
  }, [SRC]);

  // Stop and clean up on unmount.
  useEffect(() => {
    return () => {
      if (srRef.current) {
        srRef.current.abort();
        srRef.current = null;
      }
    };
  }, []);

  return { supported, listening, start, stop };
}
