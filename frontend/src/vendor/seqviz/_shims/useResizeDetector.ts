// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
// Local shim replacing @lattice-automation/react-resize-detector.
// SeqViz only consumes { width, height, ref } from the hook. We implement
// the same surface with a ResizeObserver so we avoid vendoring the upstream
// package and its es-toolkit dependency.
//
// seqviz spike bot
import { useEffect, useRef, useState } from "react";

interface ResizeResult {
  width?: number;
  height?: number;
  ref: React.RefObject<HTMLDivElement | null>;
}

export function useResizeDetector(): ResizeResult {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width?: number; height?: number }>({});

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({ width: cr.width, height: cr.height });
      }
    });
    ro.observe(el);
    // seed immediately so first paint has a size
    setSize({ width: el.clientWidth, height: el.clientHeight });

    return () => ro.disconnect();
  }, []);

  return { width: size.width, height: size.height, ref };
}
