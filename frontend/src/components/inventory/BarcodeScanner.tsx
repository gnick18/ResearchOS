"use client";

// The webcam barcode scanner (chunk 6, design 15.5). Renders the viewfinder +
// reticle from the approved mockup over a getUserMedia video stream and reads
// barcodes with the browser-native BarcodeDetector (the app is Chrome / Edge
// only, where it is available). On a successful read it calls `onDetect(code)`.
//
// Graceful fallback (design 15.5): if BarcodeDetector is undefined, or the
// camera is denied / unavailable, the scanner shows a "Type a code instead"
// text field so the feature still works without a camera. The user can also
// switch to typing at any time.
//
// House style: <Icon> only (the reticle corners are CSS borders, not icons),
// brand + semantic dark-mode tokens, no emojis / em-dashes / mid-sentence
// colons. NO new npm dependency (built-in BarcodeDetector only).

import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons";

// --- Minimal ambient typing for the Barcode Detection API ----------------
// BarcodeDetector is not in lib.dom.d.ts yet, so we declare just the surface we
// use. Feature-detected at runtime before any call.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
}
function getBarcodeDetectorCtor(): BarcodeDetectorCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
}

// The formats worth detecting for lab labels: retail product barcodes plus the
// Code 128 / QR a lab printer applies to a container. We request these but fall
// back to the detector's defaults if it rejects the option.
const SCAN_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "qr_code",
];

type Phase = "starting" | "scanning" | "fallback";

export default function BarcodeScanner({
  onDetect,
  onClose,
}: {
  /** Called once with the decoded string when a barcode is read (or typed). */
  onDetect: (code: string) => void;
  /** Close the scanner without a result. */
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  // Latch so we fire onDetect exactly once even if the detection loop and an
  // in-flight frame race on the same barcode.
  const firedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("starting");
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  // Stop the camera + cancel the detection loop. Safe to call repeatedly.
  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const fire = useCallback(
    (code: string) => {
      if (firedRef.current) return;
      const trimmed = code.trim();
      if (!trimmed) return;
      firedRef.current = true;
      stopCamera();
      onDetect(trimmed);
    },
    [onDetect, stopCamera],
  );

  // Drop to the type-a-code fallback with an optional explanation.
  const dropToFallback = useCallback(
    (hint: string | null) => {
      stopCamera();
      setErrorHint(hint);
      setPhase("fallback");
    },
    [stopCamera],
  );

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const Ctor = getBarcodeDetectorCtor();
      if (!Ctor) {
        dropToFallback(
          "Your browser does not support live barcode detection. Type the code instead.",
        );
        return;
      }

      // Build the detector, narrowing the requested formats to what this engine
      // supports so an unsupported format does not throw.
      try {
        let formats = SCAN_FORMATS;
        if (Ctor.getSupportedFormats) {
          const supported = await Ctor.getSupportedFormats();
          const allowed = SCAN_FORMATS.filter((f) => supported.includes(f));
          if (allowed.length > 0) formats = allowed;
        }
        detectorRef.current = new Ctor({ formats });
      } catch {
        // Constructing with formats failed; try the default constructor.
        try {
          detectorRef.current = new Ctor();
        } catch {
          dropToFallback(
            "Live barcode detection is unavailable here. Type the code instead.",
          );
          return;
        }
      }

      // Ask for the rear camera when present, else any camera.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        if (cancelled) return;
        dropToFallback(
          "No camera, or camera access was blocked. Type the code instead.",
        );
        return;
      }
      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay can be deferred; the loop still reads frames once ready.
      }
      if (cancelled) return;
      setPhase("scanning");
      runDetectLoop();
    }

    function runDetectLoop() {
      const tick = async () => {
        if (cancelled || firedRef.current) return;
        const video = videoRef.current;
        const detector = detectorRef.current;
        if (video && detector && video.readyState >= 2) {
          try {
            const found = await detector.detect(video);
            if (!cancelled && found.length > 0) {
              const value = found[0]?.rawValue ?? "";
              if (value) {
                fire(value);
                return;
              }
            }
          } catch {
            // A transient detect() failure (e.g. a not-ready frame) is fine; we
            // just try the next frame. A persistent failure simply never fires,
            // and the user can fall back to typing.
          }
        }
        if (!cancelled && !firedRef.current) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    void start();

    return () => {
      cancelled = true;
      stopCamera();
    };
    // Mount-once: the callbacks are stable (useCallback) and re-running would
    // restart the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    fire(typed);
  };

  return (
    <div className="p-5">
      <h2 className="mb-3 text-title font-semibold text-foreground">
        Scan a barcode
      </h2>

      {phase !== "fallback" ? (
        <>
          {/* Viewfinder + reticle (CSS borders, per the mockup). */}
          <div className="relative flex h-60 items-center justify-center overflow-hidden rounded-xl bg-slate-900">
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="pointer-events-none relative h-[46%] w-[70%] rounded-lg border-2 border-white/85 shadow-[0_0_0_2000px_rgba(0,0,0,0.35)]">
              <span className="absolute -left-0.5 -top-0.5 h-4 w-4 rounded-tl-lg border-l-[3px] border-t-[3px] border-brand-action" />
              <span className="absolute -right-0.5 -top-0.5 h-4 w-4 rounded-tr-lg border-r-[3px] border-t-[3px] border-brand-action" />
              <span className="absolute -bottom-0.5 -left-0.5 h-4 w-4 rounded-bl-lg border-b-[3px] border-l-[3px] border-brand-action" />
              <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-br-lg border-b-[3px] border-r-[3px] border-brand-action" />
            </div>
            <div className="pointer-events-none absolute bottom-2.5 left-0 right-0 text-center text-meta text-white/85">
              {phase === "starting"
                ? "Starting your camera."
                : "Point your webcam at a container code or product barcode"}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => dropToFallback(null)}
              className="ros-btn-neutral px-3 py-2 text-body text-foreground"
            >
              Type a code instead
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ros-btn-neutral px-3 py-2 text-body text-foreground"
            >
              Close
            </button>
          </div>
          <p className="mt-3 border-t border-border pt-2.5 text-meta text-foreground-muted">
            Needs camera permission once. Works in Chrome and Edge, the same as
            the rest of the app. No camera, use type-a-code.
          </p>
        </>
      ) : (
        // Type-a-code fallback (no detector, or no / blocked camera).
        <form onSubmit={submitTyped}>
          {errorHint && (
            <p className="mb-3 rounded-lg bg-surface-sunken px-3 py-2 text-meta text-foreground-muted">
              {errorHint}
            </p>
          )}
          <label className="mb-1 block text-meta font-medium text-foreground-muted">
            Enter the code
          </label>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Container code or product barcode"
            className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-body text-foreground placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-action"
          />
          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onClose}
              className="ros-btn-neutral px-3 py-2 text-body text-foreground"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={!typed.trim()}
              className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-body disabled:opacity-50"
            >
              <Icon name="scan" className="h-4 w-4" />
              Look up code
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
