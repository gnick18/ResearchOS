"use client";

// The Figure page composer surface. Arranges figures from any registered
// FigureSource onto one real publication page: drag to place, snap to a grid,
// auto labels (A/B/C), export one exact SVG. v1 covers panels + the add-figure
// picker + the inspector + snap-grid/undo + export; the annotation-placement UI
// is a fast follow (the model + compositor already support annotations).
//
// House style: <Icon> only, Tooltip on icon-only buttons, no emojis / em-dashes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  type FigurePage,
  type LabelStyle,
  type Annotation,
  pageSizeIn,
  assignLabels,
  addPanel,
  removePanel,
  snapToGrid,
  fitPanelsToPage,
  addAnnotation,
  removeAnnotation,
  updateAnnotation,
  moveAnnotation,
  makeTextAnnotation,
  makeArrowAnnotation,
  makeBracketAnnotation,
  type TextVariant,
  TEXT_VARIANT_PT,
  setPanelStyle,
  setPanelTarget,
  pageAssets,
  makePlacedAsset,
  addPlacedAsset,
  removePlacedAsset,
  updatePlacedAsset,
  figureCredits,
  type FigureShape,
  type ShapeKind,
  pageShapes,
  makeShape,
  addShape,
  removeShape,
  updateShape,
  type Connector,
  type ConnectorEnd,
  type ConnectorShape,
  pageConnectors,
  makeConnector,
  addConnector,
  removeConnector,
  updateConnector,
  pruneConnectors,
  visiblePanels,
  visibleAssets,
  visibleShapes,
  visibleAnnotations,
} from "@/lib/figure/figure-page";
import { elementAnchors, nearestSide, type Point } from "@/lib/figure/figure-connectors";
import {
  type ElementRef,
  type Box,
  type SnapGuide,
  type AlignEdge,
  type AlignTarget,
  type DistributeAnchor,
  sameRef,
  elementBox,
  unionBox,
  alignElements,
  distributeElements,
  distributeSpacing,
  computeSnap,
  translateElement,
  elementsInRect,
  elementAtPoint,
  listElements,
  bringToFront,
  sendToBack,
  bringForward,
  sendBackward,
  setGroupId,
  groupMates,
  flipElements,
  setElementLocked,
  setElementHidden,
  isElementLocked,
  isElementHidden,
  setElementSize,
  setElementRotation,
  duplicateElements,
} from "@/lib/figure/figure-arrange";
import { elementTransform, elementTransformCss } from "@/lib/figure/figure-compose";
import {
  getFigureSource,
  listFigureSources,
  type FigureRef,
  type StyleTarget,
} from "@/lib/figure/figure-source";
import { buildPickerView, type GroupBy } from "@/lib/figure/picker-view";
import {
  readFigurePage,
  saveFigurePage,
  createFigurePageDoc,
  listFigurePages,
} from "@/lib/figure/figure-page-store";
import FigureLeftRail, { type LayerItem } from "@/components/figure/FigureLeftRail";
import { applyTemplateSized } from "@/lib/figure/figure-templates";
import {
  composeFigurePageSvg,
  annotationLayerSvg,
  connectorLayerSvg,
  recolorPlacedAsset,
  extractFills,
} from "@/lib/figure/figure-compose";
import {
  ASSET_LIBRARY_ENABLED,
  fetchAssetSvg,
  type LibraryAsset,
} from "@/lib/figure/asset-library";
import { registerFigureSources } from "@/lib/figure/register-sources";
import { BeakerBotLoader } from "@/components/page-boot/BeakerBotLoader";
import {
  runBoot,
  createLocalTimingStore,
  PAGE_BOOT_WHY_HREF,
  type BootState,
  type BootTask,
} from "@/lib/page-boot/page-boot";
import { PAPER_PRESETS } from "@/lib/figure/artboard";
import ZoomPanCanvas from "@/components/figure/ZoomPanCanvas";
import { CompositionPanelAdvisor } from "@/components/figure/CompositionPanelAdvisor";

const SCREEN_DPI = 96;

// Per-page boot timing cache (for the honest ETA on repeat opens). Module scope
// so it is shared across mounts and not rebuilt every render.
const figureTimingStore = createLocalTimingStore();

// Render one panel's SVG with the same options the reactive render effect uses.
// Returns null when the source is missing or the render throws, so one bad panel
// falls through to the compositor's placeholder instead of failing the whole boot.
async function renderPanelSvg(p: FigurePage["panels"][number]): Promise<string | null> {
  const src = getFigureSource(p.ref.type);
  if (!src) return null;
  try {
    const r = await src.render(p.ref.id, {
      widthIn: p.wIn,
      heightIn: p.hIn,
      dpi: SCREEN_DPI,
      theme: "light",
      overrides: { hideTitle: p.overrides?.hideTitle ?? true, hideLegend: p.overrides?.hideLegend },
      style: p.style,
    });
    return r.svg;
  } catch {
    return null;
  }
}

/** Icon-only button for the Illustrator-style arrange bar. */
const ARRANGE_ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded border border-border-strong text-foreground hover:border-brand-action hover:text-brand-action disabled:cursor-not-allowed disabled:opacity-40 transition-colors";

/** Active/selected state for the align-to toggle buttons. */
const ARRANGE_ICON_BTN_ACTIVE =
  "flex h-7 w-7 items-center justify-center rounded border bg-brand-action/10 border-brand-action text-brand-action transition-colors";

/** Coerce a fill value to a #rrggbb hex for an <input type="color"> (fallback grey). */
function toHex6(c: string): string {
  const v = c.trim();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  return "#888888";
}

/** A signature of what affects a panel's RENDER (ref + size + title, not position). */
function renderSignature(page: FigurePage): string {
  return page.panels
    .map(
      (p) =>
        `${p.panelId}:${p.ref.type}:${p.ref.id}:${p.wIn.toFixed(3)}x${p.hIn.toFixed(3)}:${p.overrides?.hideTitle ?? true}:${JSON.stringify(p.style ?? {})}`,
    )
    .join("|");
}

export default function FigureComposer({ pageId }: { pageId: string }) {
  const [page, setPage] = useState<FigurePage | null>(null);
  // All figure pages, for the left-rail Figures file list (replaces the hub).
  const [pages, setPages] = useState<FigurePage[]>([]);
  const [panelSvgs, setPanelSvgs] = useState<Map<string, string>>(new Map());
  // Unified multi-selection (the Phase 1 diagram-tool model). The per-kind single
  // selections below are DERIVED from it, so the existing inspector + drag code is
  // unchanged; the align bar + group drag operate on the full `selection`.
  const [selection, setSelection] = useState<ElementRef[]>([]);
  const single = selection.length === 1 ? selection[0] : null;
  const selected = single?.kind === "panel" ? single.id : null;
  const selectedAsset = single?.kind === "asset" ? single.id : null;
  const selectedAnn = single?.kind === "annotation" ? single.id : null;
  const selectedShape = single?.kind === "shape" ? single.id : null;
  const isSelectedRef = (ref: ElementRef) => selection.some((r) => sameRef(r, ref));
  const selectRef = (ref: ElementRef, additive: boolean) => {
    setSelection((prev) => {
      if (additive) {
        if (prev.some((r) => sameRef(r, ref))) {
          // Removing from selection: if removed item was the key object, clear it.
          setKeyRef((k) => (k && sameRef(k, ref) ? null : k));
          return prev.filter((r) => !sameRef(r, ref));
        }
        // Adding to selection: the newly added element becomes the key object.
        setKeyRef(ref);
        return [...prev, ref];
      }
      // Plain (non-additive) click: single element; it is its own key object.
      setKeyRef(ref);
      return [ref];
    });
  };
  const clearSel = () => {
    setSelection([]);
    setSelectedConn(null);
  };
  const [undo, setUndo] = useState<FigurePage[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Arrange bar: align-to-target toggle (persists for the session).
  const [alignTarget, setAlignTarget] = useState<AlignTarget>("selection");
  // Arrange bar: gap value (in inches) for the distribute-spacing controls.
  const [spacingGapIn, setSpacingGapIn] = useState<number>(0.1);
  // Key object: the last element clicked into the selection. Used when
  // alignTarget = "key" (others align to this element, which stays fixed).
  const [keyRef, setKeyRef] = useState<ElementRef | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing">("loading");
  // Honest page-boot loader state. Non-null while the initial read + first full
  // panel-render pass runs, so opening a figure shows the BeakerBot loader over an
  // already-drawn composer rather than a blank line that pops panels in one by one.
  const [bootState, setBootState] = useState<BootState | null>(null);
  // The render signature the boot already drew, so the reactive render effect can
  // skip the identical first pass (avoids a visible double draw on open).
  const renderedSigRef = useRef<string | null>(null);
  // Bumped to retry a failed boot (no soft-lock).
  const [bootAttempt, setBootAttempt] = useState(0);
  const [tool, setTool] = useState<null | "text" | "arrow" | "bracket" | "connect">(null);
  // Smart-connector state (Phase 2). selectedConn is kept separate from the element
  // selection (connectors are not panels/icons/annotations). connDraw holds an
  // in-progress connector while dragging from an anchor node; connCursor is the
  // live cursor in inches for the rubber line.
  const [selectedConn, setSelectedConn] = useState<string | null>(null);
  const connDraw = useRef<null | { from: ConnectorEnd; startIn: Point }>(null);
  const [connCursor, setConnCursor] = useState<Point | null>(null);
  // Icon recolor mode: whole-icon single tint, or per-fill (multi-part) recolor.
  const [recolorMode, setRecolorMode] = useState<"whole" | "part">("whole");
  // Which typed-text style the Text tool places (Heading / Label / Body).
  const [textVariant, setTextVariant] = useState<TextVariant>("label");
  // Marquee drag-select rectangle (inches), live while dragging on empty canvas.
  const [marquee, setMarquee] = useState<Box | null>(null);
  const marqueeRef = useRef<null | { sx: number; sy: number; box?: Box }>(null);
  // Smart-guide alignment lines (inches) shown while dragging an element.
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [styleTargets, setStyleTargets] = useState<StyleTarget[]>([]);
  const [defaultSaved, setDefaultSaved] = useState(false);
  // Placed-asset (icon library) state, gated behind ASSET_LIBRARY_ENABLED.
  const [assetSvgs, setAssetSvgs] = useState<Map<string, string>>(new Map());
  const assetDrag = useRef<
    | null
    | { id: string; resize: boolean; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }
  >(null);
  const shapeDrag = useRef<
    | null
    | { id: string; resize: boolean; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }
  >(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const annDrag = useRef<null | { id: string; sx: number; sy: number }>(null);
  // Group drag: move every selected element together from a snapshot of the page
  // at press time (so deltas stay absolute and snapping has a stable base).
  const groupDrag = useRef<null | { base: FigurePage; refs: ElementRef[]; sx: number; sy: number }>(null);
  // In-app clipboard (copy/paste). Not the OS clipboard; keeps full element data.
  const clipboard = useRef<ElementRef[]>([]);
  const router = useRouter();

  useEffect(() => {
    registerFigureSources();
    let live = true;
    setLoadState("loading");
    setBootState(null);
    renderedSigRef.current = null;

    void (async () => {
      // Resolve found-vs-missing FIRST with the fast page read. A missing page is a
      // legitimate recoverable not-found state (stale link or cleared demo data), so
      // it must bypass the loader entirely, no spinner and no retry loop.
      let loaded: FigurePage | null;
      try {
        loaded = await readFigurePage(pageId);
      } catch {
        if (live) setLoadState("missing");
        return;
      }
      if (!live) return;
      if (!loaded) {
        setLoadState("missing");
        return;
      }
      const found = loaded;

      // Found: gate the composer body behind the honest page-boot loader. Two real
      // tasks, a near-instant read confirm plus the first full panel-render pass,
      // which is the heavy, variable step and the real progress bar.
      const tasks: BootTask[] = [
        {
          id: "read",
          label: "Reading figure page",
          weight: 1,
          run: async () => {
            // The read already happened above; this confirms the page is in hand.
          },
        },
        {
          id: "render-panels",
          label: "Drawing panels",
          weight: found.panels.length || 1,
          run: async (onProgress) => {
            const total = found.panels.length;
            const next = new Map<string, string>();
            for (let i = 0; i < total; i++) {
              if (!live) return;
              const svg = await renderPanelSvg(found.panels[i]);
              if (svg !== null) next.set(found.panels[i].panelId, svg);
              onProgress((i + 1) / total);
            }
            if (live) setPanelSvgs(next);
          },
        },
      ];

      try {
        await runBoot(tasks, {
          pageId: "figure-composer",
          timingStore: figureTimingStore,
          onUpdate: (s) => {
            if (live) setBootState(s);
          },
        });
      } catch {
        // The error phase was already emitted to bootState; the loader shows a
        // retry. Leave page unset so the composer body stays gated behind it.
        return;
      }
      if (!live) return;
      // Mark the signature the boot already drew so the reactive effect skips the
      // identical first pass, then reveal the already-drawn composer.
      renderedSigRef.current = renderSignature(found);
      setPage(found);
      setBootState(null);
      setLoadState("ready");
    })();

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, bootAttempt]);

  // Load the figure-page list for the left-rail Figures file browser. Reloads
  // when the active page changes (e.g. after creating one), so it stays current.
  useEffect(() => {
    let live = true;
    void listFigurePages().then((p) => {
      if (live) setPages(p);
    });
    return () => {
      live = false;
    };
  }, [pageId]);

  // Resolve each panel's SVG when a ref or size changes (not on a move).
  const sig = page ? renderSignature(page) : "";
  useEffect(() => {
    if (!page) return;
    // The page-boot already drew this exact signature on open. Skip the identical
    // first pass once (avoids a visible double draw); later resize/ref changes
    // produce a new signature and render normally.
    if (renderedSigRef.current === sig) {
      renderedSigRef.current = null;
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = new Map<string, string>();
      for (const p of page.panels) {
        const svg = await renderPanelSvg(p);
        if (svg !== null) next.set(p.panelId, svg);
      }
      if (!cancelled) setPanelSvgs(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Fetch each placed asset's raw SVG from the CDN once (keyed by svgPath set), so
  // the canvas + export can inline + tint it. Cached in fetchAssetSvg per the bundle.
  const assetSig = page ? pageAssets(page).map((a) => `${a.assetId}:${a.svgPath}`).join("|") : "";
  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    void (async () => {
      const next = new Map(assetSvgs);
      let changed = false;
      for (const a of pageAssets(page)) {
        if (next.has(a.assetId)) continue;
        const svg = await fetchAssetSvg(a);
        if (svg) {
          next.set(a.assetId, svg);
          changed = true;
        }
      }
      if (!cancelled && changed) setAssetSvgs(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetSig]);

  // Load the selected panel's styleable elements (features, ...) for the style inspector.
  const selectedRef = selected
    ? page?.panels.find((p) => p.panelId === selected)?.ref
    : undefined;
  useEffect(() => {
    setDefaultSaved(false);
    if (!selectedRef) {
      setStyleTargets([]);
      return;
    }
    const src = getFigureSource(selectedRef.type);
    if (!src?.styleTargets) {
      setStyleTargets([]);
      return;
    }
    let live = true;
    void src.styleTargets(selectedRef.id).then((t) => {
      if (live) setStyleTargets(t);
    });
    return () => {
      live = false;
    };
  }, [selectedRef?.type, selectedRef?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutate = useCallback(
    (fn: (p: FigurePage) => FigurePage, recordUndo = false) => {
      setPage((prev) => {
        if (!prev) return prev;
        if (recordUndo) setUndo((u) => [...u.slice(-19), prev]);
        const nextPage = fn(prev);
        void saveFigurePage(nextPage);
        return nextPage;
      });
    },
    [],
  );

  const doUndo = useCallback(() => {
    setUndo((u) => {
      if (u.length === 0) return u;
      const prev = u[u.length - 1];
      void saveFigurePage(prev);
      setPage(prev);
      return u.slice(0, -1);
    });
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Cmd/Ctrl+C = copy, +V = paste, +D = duplicate, +G = group,
  // +Shift+G = ungroup, Delete/Backspace = delete selection, +Z = undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      // Don't steal from text inputs.
      const tag = (e.target as Element).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;

      if (meta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
        return;
      }

      // Copy
      if (meta && e.key === "c") {
        if (selection.length > 0) {
          clipboard.current = [...selection];
        }
        return;
      }

      // Paste (offset by +12px at current scale = ~0.125 in)
      if (meta && e.key === "v") {
        if (clipboard.current.length === 0 || !page) return;
        e.preventDefault();
        const PASTE_OFFSET = 0.15;
        mutate((p) => {
          const { page: next, newRefs } = duplicateElements(p, clipboard.current, PASTE_OFFSET);
          // Update clipboard so repeated paste cascades
          clipboard.current = newRefs;
          return next;
        }, true);
        return;
      }

      // Duplicate in place (+offset)
      if (meta && e.key === "d") {
        if (selection.length === 0 || !page) return;
        e.preventDefault();
        let newRefs: ElementRef[] = [];
        mutate((p) => {
          const result = duplicateElements(p, selection, 0.15);
          newRefs = result.newRefs;
          return result.page;
        }, true);
        // Update selection after state flush (use a ref trick)
        setTimeout(() => setSelection(newRefs), 0);
        return;
      }

      // Group
      if (meta && e.key === "g" && !e.shiftKey) {
        if (selection.length < 2) return;
        e.preventDefault();
        const gid = `g${Date.now().toString(36)}`;
        mutate((p) => setGroupId(p, selection, gid), true);
        return;
      }

      // Ungroup
      if (meta && e.key === "g" && e.shiftKey) {
        if (selection.length === 0) return;
        e.preventDefault();
        mutate((p) => setGroupId(p, selection, null), true);
        return;
      }

      // Delete / Backspace = delete selection
      if ((e.key === "Delete" || e.key === "Backspace") && selection.length > 0) {
        e.preventDefault();
        mutate((p) => {
          let next = p;
          for (const ref of selection) {
            if (ref.kind === "panel") next = pruneConnectors(removePanel(next, ref.id));
            else if (ref.kind === "asset") next = pruneConnectors(removePlacedAsset(next, ref.id));
            else if (ref.kind === "shape") next = pruneConnectors(removeShape(next, ref.id));
            else if (ref.kind === "annotation") next = pruneConnectors(removeAnnotation(next, ref.id));
          }
          return next;
        }, true);
        clearSel();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, page, doUndo, mutate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pixel scale: fit the page into a ~560px tall stage.
  const scale = useMemo(() => {
    if (!page) return SCREEN_DPI;
    const { hIn } = pageSizeIn(page);
    return Math.min(SCREEN_DPI, 560 / hIn);
  }, [page]);

  // On-screen pixels per inch RIGHT NOW, measured from the live stage rect so it
  // includes the ZoomPanCanvas zoom transform. Drag math divides by this (not the
  // static fit `scale`) so panels/icons track the cursor 1:1 at any zoom level.
  // Falls back to the fit scale before the stage has mounted.
  const effScale = useCallback(() => {
    const el = stageRef.current;
    if (!el || !page) return scale;
    const { wIn } = pageSizeIn(page);
    const r = el.getBoundingClientRect();
    return wIn > 0 ? r.width / wIn : scale;
  }, [page, scale]);

  // Drag / resize a panel.
  const drag = useRef<
    | null
    | { id: string; resize: boolean; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }
  >(null);

  // Select on press: shift toggles into the multi-selection; a plain click on an
  // element already in a multi-selection KEEPS the group (so it can be dragged
  // together), otherwise it selects only that element. Clicking any member of a
  // groupId group auto-selects the whole group.
  const pressSelect = (ref: ElementRef, e: React.MouseEvent) => {
    if (!page) return;
    setSelectedConn(null);
    if (e.shiftKey) {
      selectRef(ref, true);
    } else if (!isSelectedRef(ref)) {
      // Auto-expand to group mates.
      const mates = groupMates(page, ref);
      setSelection(mates);
    }
  };

  // If a plain (non-resize, non-shift) press lands on an element that is part of a
  // multi-selection, drag the whole group instead of just that element. Returns
  // true when it claimed the press.
  const maybeGroupDrag = (ref: ElementRef, e: React.MouseEvent, resize: boolean): boolean => {
    if (resize || e.shiftKey || selection.length < 2 || !isSelectedRef(ref) || !page) return false;
    groupDrag.current = { base: page, refs: selection, sx: e.clientX, sy: e.clientY };
    return true;
  };

  const onPanelDown = (e: React.MouseEvent, id: string, resize: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    const ref: ElementRef = { kind: "panel", id };
    if (page && isElementLocked(page, ref)) { pressSelect(ref, e); return; }
    if (maybeGroupDrag(ref, e, resize)) return;
    pressSelect(ref, e);
    const p = page?.panels.find((x) => x.panelId === id);
    if (!p) return;
    drag.current = { id, resize, sx: e.clientX, sy: e.clientY, ox: p.xIn, oy: p.yIn, ow: p.wIn, oh: p.hIn };
  };

  const onAssetDown = (e: React.MouseEvent, id: string, resize: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    const ref: ElementRef = { kind: "asset", id };
    if (page && isElementLocked(page, ref)) { pressSelect(ref, e); return; }
    if (maybeGroupDrag(ref, e, resize)) return;
    pressSelect(ref, e);
    const a = page ? pageAssets(page).find((x) => x.assetId === id) : undefined;
    if (!a) return;
    assetDrag.current = { id, resize, sx: e.clientX, sy: e.clientY, ox: a.xIn, oy: a.yIn, ow: a.wIn, oh: a.hIn };
  };

  const onShapeDown = (e: React.MouseEvent, id: string, resize: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    const ref: ElementRef = { kind: "shape", id };
    if (page && isElementLocked(page, ref)) { pressSelect(ref, e); return; }
    if (maybeGroupDrag(ref, e, resize)) return;
    pressSelect(ref, e);
    const s = page ? pageShapes(page).find((x) => x.shapeId === id) : undefined;
    if (!s) return;
    shapeDrag.current = { id, resize, sx: e.clientX, sy: e.clientY, ox: s.xIn, oy: s.yIn, ow: s.wIn, oh: s.hIn };
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const s = effScale();
      let dxIn = (e.clientX - d.sx) / s;
      let dyIn = (e.clientY - d.sy) / s;
      if (!d.resize && page) {
        const ps = pageSizeIn(page);
        const snap = computeSnap(
          page,
          { kind: "panel", id: d.id },
          { xIn: d.ox + dxIn, yIn: d.oy + dyIn, wIn: d.ow, hIn: d.oh },
          { pageWIn: ps.wIn, pageHIn: ps.hIn },
        );
        dxIn += snap.dxIn;
        dyIn += snap.dyIn;
        setGuides(snap.guides);
      }
      mutate((prev) => ({
        ...prev,
        panels: prev.panels.map((p) =>
          p.panelId !== d.id
            ? p
            : d.resize
              ? { ...p, wIn: Math.max(0.6, d.ow + dxIn), hIn: Math.max(0.5, d.oh + dyIn) }
              : { ...p, xIn: Math.max(0, d.ox + dxIn), yIn: Math.max(0, d.oy + dyIn) },
        ),
      }));
    };
    const up = () => {
      drag.current = null;
      setGuides([]);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [effScale, mutate, page]);

  // Drag / resize a placed asset (mirrors the panel drag).
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = assetDrag.current;
      if (!d) return;
      const s = effScale();
      let dxIn = (e.clientX - d.sx) / s;
      let dyIn = (e.clientY - d.sy) / s;
      if (d.resize) {
        mutate((prev) =>
          updatePlacedAsset(prev, d.id, {
            wIn: Math.max(0.2, d.ow + dxIn),
            hIn: Math.max(0.2, d.oh + dyIn),
          }),
        );
      } else {
        if (page) {
          const ps = pageSizeIn(page);
          const snap = computeSnap(
            page,
            { kind: "asset", id: d.id },
            { xIn: d.ox + dxIn, yIn: d.oy + dyIn, wIn: d.ow, hIn: d.oh },
            { pageWIn: ps.wIn, pageHIn: ps.hIn },
          );
          dxIn += snap.dxIn;
          dyIn += snap.dyIn;
          setGuides(snap.guides);
        }
        mutate((prev) =>
          updatePlacedAsset(prev, d.id, {
            xIn: Math.max(0, d.ox + dxIn),
            yIn: Math.max(0, d.oy + dyIn),
          }),
        );
      }
    };
    const up = () => {
      assetDrag.current = null;
      setGuides([]);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [effScale, mutate, page]);

  // Drag / resize a shape (mirrors the asset drag).
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = shapeDrag.current;
      if (!d) return;
      const s = effScale();
      let dxIn = (e.clientX - d.sx) / s;
      let dyIn = (e.clientY - d.sy) / s;
      if (d.resize) {
        mutate((prev) =>
          updateShape(prev, d.id, { wIn: Math.max(0.2, d.ow + dxIn), hIn: Math.max(0.2, d.oh + dyIn) }),
        );
      } else {
        if (page) {
          const ps = pageSizeIn(page);
          const snap = computeSnap(
            page,
            { kind: "shape", id: d.id },
            { xIn: d.ox + dxIn, yIn: d.oy + dyIn, wIn: d.ow, hIn: d.oh },
            { pageWIn: ps.wIn, pageHIn: ps.hIn },
          );
          dxIn += snap.dxIn;
          dyIn += snap.dyIn;
          setGuides(snap.guides);
        }
        mutate((prev) =>
          updateShape(prev, d.id, { xIn: Math.max(0, d.ox + dxIn), yIn: Math.max(0, d.oy + dyIn) }),
        );
      }
    };
    const up = () => {
      shapeDrag.current = null;
      setGuides([]);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [effScale, mutate, page]);

  // Drag a selected annotation (translates all of its anchor points).
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = annDrag.current;
      if (!d) return;
      const s = effScale();
      const dxIn = (e.clientX - d.sx) / s;
      const dyIn = (e.clientY - d.sy) / s;
      if (dxIn === 0 && dyIn === 0) return;
      annDrag.current = { ...d, sx: e.clientX, sy: e.clientY };
      mutate((prev) => moveAnnotation(prev, d.id, dxIn, dyIn));
    };
    const up = () => {
      annDrag.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [effScale, mutate]);

  // Group drag: move the whole multi-selection together, rebuilt each move from
  // the press-time snapshot so the delta stays absolute, with snapping on the
  // union box (excluding the moving group).
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const g = groupDrag.current;
      if (!g) return;
      const s = effScale();
      let dxIn = (e.clientX - g.sx) / s;
      let dyIn = (e.clientY - g.sy) / s;
      const u = unionBox(g.base, g.refs);
      if (u) {
        const ps = pageSizeIn(g.base);
        const snap = computeSnap(
          g.base,
          g.refs,
          { xIn: u.xIn + dxIn, yIn: u.yIn + dyIn, wIn: u.wIn, hIn: u.hIn },
          { pageWIn: ps.wIn, pageHIn: ps.hIn },
        );
        dxIn += snap.dxIn;
        dyIn += snap.dyIn;
        setGuides(snap.guides);
      }
      mutate(() => {
        let next = g.base;
        for (const r of g.refs) next = translateElement(next, r, dxIn, dyIn);
        return next;
      });
    };
    const up = () => {
      if (groupDrag.current) {
        groupDrag.current = null;
        setGuides([]);
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [effScale, mutate]);

  // Marquee (rubber-band) drag-select on the empty canvas.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const m = marqueeRef.current;
      if (!m) return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const s = effScale();
      const cx = (e.clientX - rect.left) / s;
      const cy = (e.clientY - rect.top) / s;
      const box: Box = {
        xIn: Math.min(m.sx, cx),
        yIn: Math.min(m.sy, cy),
        wIn: Math.abs(cx - m.sx),
        hIn: Math.abs(cy - m.sy),
      };
      m.box = box;
      setMarquee(box);
    };
    const up = () => {
      const m = marqueeRef.current;
      marqueeRef.current = null;
      setMarquee(null);
      if (!m?.box || !page) return;
      const box = m.box;
      if (box.wIn <= 0.05 && box.hIn <= 0.05) return;
      const hits = elementsInRect(page, box);
      // The start-press cleared the selection unless Shift was held, so merging
      // into the current selection gives "replace" (plain) or "add" (shift).
      setSelection((prev) => {
        const merged = [...prev];
        for (const h of hits) if (!merged.some((r) => sameRef(r, h))) merged.push(h);
        return merged;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [effScale, page]);

  // Smart-connector draw: drag from an anchor node, drop on an element to connect.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!connDraw.current) return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const s = effScale();
      setConnCursor({ xIn: (e.clientX - rect.left) / s, yIn: (e.clientY - rect.top) / s });
    };
    const up = (e: MouseEvent) => {
      const d = connDraw.current;
      connDraw.current = null;
      setConnCursor(null);
      if (!d || !page) return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const s = effScale();
      const xIn = (e.clientX - rect.left) / s;
      const yIn = (e.clientY - rect.top) / s;
      const target = elementAtPoint(page, xIn, yIn);
      // Need a target that exists and is not the source element.
      if (!target || sameRef(target, d.from.ref as ElementRef)) {
        setTool(null);
        return;
      }
      const tBox = elementBox(page, target);
      if (!tBox) {
        setTool(null);
        return;
      }
      const to: ConnectorEnd = { ref: target, side: nearestSide(tBox, d.startIn) };
      const connId = `cn${page.id}-${Date.now().toString(36)}`;
      mutate((p) => addConnector(p, makeConnector(connId, d.from, to)), true);
      setSelection([]);
      setSelectedConn(connId);
      setTool(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [effScale, mutate, page]);

  const exportSvg = useCallback(() => {
    if (!page) return;
    const svg = composeFigurePageSvg(page, { pxPerInch: 300, panelSvgs, assetSvgs });
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${page.name || "figure"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [page, panelSvgs, assetSvgs]);

  // PNG export at 300 dpi: rasterize the composed SVG via an offscreen canvas.
  // No new dependency: uses the browser's built-in Image + canvas.drawImage.
  const exportPng = useCallback(() => {
    if (!page) return;
    const DPI = 300;
    const { wIn, hIn } = pageSizeIn(page);
    const svgStr = composeFigurePageSvg(page, { pxPerInch: DPI, panelSvgs, assetSvgs });
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(wIn * DPI);
      canvas.height = Math.round(hIn * DPI);
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); return; }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        const pngUrl = URL.createObjectURL(pngBlob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = `${page.name || "figure"}.png`;
        a.click();
        URL.revokeObjectURL(pngUrl);
      }, "image/png");
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, [page, panelSvgs, assetSvgs]);

  // PDF export (vector): renders the composed SVG as a true vector PDF sized to the
  // real artboard dimensions in inches. jsPDF + svg2pdf.js are dynamically imported
  // so they stay out of the initial bundle (each is ~300-500 kB minified).
  // Hidden/locked elements are automatically excluded because composeFigurePageSvg
  // already filters them.
  const exportPdf = useCallback(async () => {
    if (!page) return;
    const { wIn, hIn } = pageSizeIn(page);
    // Compose at 300 ppi so nested viewBoxes have enough resolution for svg2pdf to
    // faithfully trace paths. The PDF itself is vector so the ppi only affects how
    // finely sub-SVG viewboxes are sampled when svg2pdf cannot parse them natively.
    const svgStr = composeFigurePageSvg(page, { pxPerInch: 300, panelSvgs, assetSvgs });

    // Parse the SVG string into a real DOM element for svg2pdf (it requires Element,
    // not a string). A detached div keeps this off-screen and out of the layout.
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.visibility = "hidden";
    container.innerHTML = svgStr;
    document.body.appendChild(container);
    const svgEl = container.querySelector("svg");
    if (!svgEl) { document.body.removeChild(container); return; }

    try {
      // Dynamic imports keep jsPDF + svg2pdf out of the main bundle.
      const [{ jsPDF }, { svg2pdf }] = await Promise.all([
        import("jspdf"),
        import("svg2pdf.js"),
      ]);

      // Landscape vs portrait: jsPDF chooses orientation from the format array.
      const orientation = wIn >= hIn ? "l" : "p";
      const doc = new jsPDF({
        orientation,
        unit: "in",
        format: [wIn, hIn],
      });

      // Render the SVG into the first (only) page, scaled to fill the page exactly.
      await svg2pdf(svgEl, doc, { x: 0, y: 0, width: wIn, height: hIn });

      doc.save(`${page.name || "figure"}.pdf`);
    } finally {
      document.body.removeChild(container);
    }
  }, [page, panelSvgs, assetSvgs]);

  if (loadState === "missing") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Icon name="alert" className="h-7 w-7 text-foreground-faint" />
        <div>
          <p className="text-body font-semibold text-foreground">This figure page could not be found.</p>
          <p className="mt-1 text-meta text-foreground-muted">
            It may have been deleted, or the link is out of date.
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Link
            href="/figures"
            className="rounded-lg bg-brand-action px-3 py-1.5 text-meta font-semibold text-white"
          >
            Back to figures
          </Link>
          <button
            type="button"
            onClick={async () => {
              const created = await createFigurePageDoc("Untitled figure", null);
              router.push(`/figures/${created.id}`);
            }}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-brand-action"
          >
            New figure page
          </button>
        </div>
      </div>
    );
  }

  if (loadState === "loading" || !page) {
    // Honest page-boot loader over the page read plus the first full panel-render
    // pass, so the composer reveals already-drawn. On a render failure it shows a
    // retry, never a soft-lock; a found page with zero panels resolves promptly.
    if (bootState) {
      return (
        <div className="flex h-full items-center justify-center">
          <BeakerBotLoader
            state={bootState}
            blurb="Drawing your figure page in your browser, so nothing uploads. It caches timings, so the next open shows a real estimate."
            whyHref={PAGE_BOOT_WHY_HREF}
            onRetry={() => setBootAttempt((a) => a + 1)}
          />
        </div>
      );
    }
    return <div className="p-8 text-body text-foreground-muted">Loading figure page...</div>;
  }

  const { wIn, hIn } = pageSizeIn(page);
  const labels = assignLabels(page);
  const pageW = wIn * scale;
  const pageH = hIn * scale;

  // Layers panel: every element, front-most first (top of the list = front).
  const layerItems: LayerItem[] = [...listElements(page)].reverse().map((ref) => {
    if (ref.kind === "panel") {
      const p = page.panels.find((x) => x.panelId === ref.id);
      const lab = labels.get(ref.id);
      return { ref, label: lab ? `Panel ${lab}` : "Panel", icon: "figure" as const, locked: p?.locked, hidden: p?.hidden };
    }
    if (ref.kind === "asset") {
      const a = pageAssets(page).find((x) => x.assetId === ref.id);
      return { ref, label: "Icon", icon: "library" as const, locked: a?.locked, hidden: a?.hidden };
    }
    if (ref.kind === "shape") {
      const s = pageShapes(page).find((x) => x.shapeId === ref.id);
      return { ref, label: s?.kind === "ellipse" ? "Ellipse" : "Rectangle", icon: "pencil" as const, locked: s?.locked, hidden: s?.hidden };
    }
    const a = page.annotations.find((x) => x.annId === ref.id);
    const label =
      a?.kind === "text" ? a.text || "Text" : a?.kind === "arrow" ? "Arrow" : "Bracket";
    return { ref, label, icon: (a?.kind === "text" ? "text" : "annotate") as "text" | "annotate", locked: a?.locked, hidden: a?.hidden };
  });
  const selectedKeys = new Set(selection.map((r) => `${r.kind}:${r.id}`));

  const placeAnnotation = (xIn: number, yIn: number) => {
    if (!tool) return;
    const annId = `a${page.id}-${Date.now().toString(36)}`;
    const ann =
      tool === "text"
        ? makeTextAnnotation(annId, xIn, yIn, textVariant)
        : tool === "arrow"
          ? makeArrowAnnotation(annId, xIn, yIn)
          : makeBracketAnnotation(annId, xIn, yIn);
    mutate((p) => addAnnotation(p, ann), true);
    setSelection([{ kind: "annotation", id: annId }]);
    setTool(null);
  };

  const onAnnDown = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const ref: ElementRef = { kind: "annotation", id };
    if (page && isElementLocked(page, ref)) { pressSelect(ref, e); return; }
    if (maybeGroupDrag(ref, e, false)) return;
    pressSelect(ref, e);
    annDrag.current = { id, sx: e.clientX, sy: e.clientY };
  };

  // Place a library asset with its top-left at (xIn, yIn), clamped to the page.
  const placeIconAt = (asset: LibraryAsset, xIn: number, yIn: number) => {
    const sizeIn = 1.2;
    const assetId = `ic${page.id}-${Date.now().toString(36)}`;
    const placed = makePlacedAsset(
      assetId,
      {
        source: asset.source,
        sourceId: asset.sourceId,
        svgPath: asset.svgPath,
        credit: asset.credit,
        requiresAttribution: asset.requiresAttribution,
        isLogo: asset.isLogo,
      },
      Math.max(0, Math.min(wIn - sizeIn, xIn)),
      Math.max(0, Math.min(hIn - sizeIn, yIn)),
      sizeIn,
    );
    mutate((p) => addPlacedAsset(p, placed), true);
    setSelectedConn(null);
    setSelection([{ kind: "asset", id: assetId }]);
    // Eagerly fetch the SVG so it appears immediately (the effect also covers it).
    void fetchAssetSvg(asset).then((svg) => {
      if (svg) setAssetSvgs((m) => new Map(m).set(assetId, svg));
    });
  };

  // Click-to-place: centered, cascading down-right so consecutive icons do not
  // stack exactly on top of each other (wrapping before it runs off the page).
  const placeIcon = (asset: LibraryAsset) => {
    const step = (pageAssets(page).length % 6) * 0.3;
    placeIconAt(asset, wIn / 2 - 0.6 + step, hIn / 2 - 0.6 + step);
  };

  // Add a shape (rectangle / ellipse) centered on the page, cascading.
  const placeShape = (kind: ShapeKind) => {
    const step = (pageShapes(page).length % 6) * 0.3;
    const shapeId = `sh${page.id}-${Date.now().toString(36)}`;
    const sh = makeShape(
      shapeId,
      kind,
      Math.max(0, wIn / 2 - 0.75 + step),
      Math.max(0, hIn / 2 - 0.5 + step),
    );
    mutate((p) => addShape(p, sh), true);
    setSelectedConn(null);
    setSelection([{ kind: "shape", id: shapeId }]);
  };

  // Drop an icon dragged from the left rail at the cursor (centered on it).
  const onCanvasDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData("application/x-ros-asset");
    if (!raw) return;
    e.preventDefault();
    let asset: LibraryAsset;
    try {
      asset = JSON.parse(raw) as LibraryAsset;
    } catch {
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = effScale();
    placeIconAt(asset, (e.clientX - rect.left) / s - 0.6, (e.clientY - rect.top) / s - 0.6);
  };

  const selectedAssetObj = selectedAsset
    ? pageAssets(page).find((a) => a.assetId === selectedAsset) ?? null
    : null;
  const selectedShapeObj = selectedShape
    ? pageShapes(page).find((s) => s.shapeId === selectedShape) ?? null
    : null;
  const credits = figureCredits(page);

  const selectedAnnotation = selectedAnn
    ? page.annotations.find((a) => a.annId === selectedAnn) ?? null
    : null;

  const selectedConnObj = selectedConn
    ? pageConnectors(page).find((c) => c.connId === selectedConn) ?? null
    : null;

  // Asset ids within a multi-selection, for bulk recolor.
  const selAssetIds = selection.filter((r) => r.kind === "asset").map((r) => r.id);

  // A static, non-interactive thumbnail of the page for the ZoomPanCanvas minimap
  // (panels + placed icons, no handlers). Without this the minimap shows just the
  // view-rect over a blank box. Rendered at the same natural size as the stage.
  const minimapStage = (
    <div className="relative h-full w-full bg-white">
      {page.panels.map((p) => (
        <div
          key={p.panelId}
          className="absolute overflow-hidden [&>svg]:h-full [&>svg]:w-full"
          style={{
            left: p.xIn * scale,
            top: p.yIn * scale,
            width: p.wIn * scale,
            height: p.hIn * scale,
          }}
          dangerouslySetInnerHTML={{ __html: panelSvgs.get(p.panelId) ?? "" }}
        />
      ))}
      {pageAssets(page).map((a) => {
        const raw = assetSvgs.get(a.assetId) ?? "";
        const display = raw ? recolorPlacedAsset(raw, a) : raw;
        return (
          <div
            key={a.assetId}
            className="absolute [&>svg]:h-full [&>svg]:w-full"
            style={{
              left: a.xIn * scale,
              top: a.yIn * scale,
              width: a.wIn * scale,
              height: a.hIn * scale,
              transform: a.rotation ? `rotate(${a.rotation}deg)` : undefined,
            }}
            dangerouslySetInnerHTML={{ __html: display }}
          />
        );
      })}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 gap-4 p-4" data-testid="figure-composer">
      {ASSET_LIBRARY_ENABLED && (
        <FigureLeftRail
          tool={tool}
          setTool={setTool}
          textVariant={textVariant}
          setTextVariant={setTextVariant}
          onPickIcon={placeIcon}
          pages={pages}
          currentPageId={page.id}
          onOpenPage={(id) => router.push(`/figures/${id}`)}
          onNewPage={async () => {
            const created = await createFigurePageDoc("Untitled figure", null);
            router.push(`/figures/${created.id}`);
          }}
          onAddFigure={() => setPickerOpen(true)}
          layers={layerItems}
          selectedKeys={selectedKeys}
          onSelectLayer={(ref) => {
            setSelectedConn(null);
            setSelection([ref]);
          }}
          onReorderLayer={(ref, dir) =>
            mutate((p) => (dir === "up" ? bringForward(p, ref) : sendBackward(p, ref)), true)
          }
          onToggleLock={(ref) =>
            mutate((p) => setElementLocked(p, ref, !isElementLocked(p, ref)), true)
          }
          onToggleHide={(ref) =>
            mutate((p) => setElementHidden(p, ref, !isElementHidden(p, ref)), true)
          }
          onAddShape={placeShape}
          onUseTemplate={(t) => mutate((p) => applyTemplateSized(p, t, wIn, hIn), true)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface-sunken">
        {/* Contextual arrange bar: icon buttons matching the Illustrator Align panel.
            Groups (separated by thin dividers):
              [align 6] | [distribute 6] | [spacing 2 + gap input] | [align-to 3-way toggle] | [flip 2] | [arrange 4] | [group/ungroup 2] */}
        {selection.length >= 1 && (
          <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-2.5 py-1.5 text-meta">
            <span className="mr-0.5 min-w-[4.5rem] text-right font-semibold text-foreground-muted">
              {selection.length} selected
            </span>
            {/* Divider */}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />

            {/* Align Objects (6 buttons) */}
            {(
              [
                ["left",    "alignLeft",    "Align left edges"],
                ["centerX", "alignCenterH", "Align horizontal centers"],
                ["right",   "alignRight",   "Align right edges"],
                ["top",     "alignTop",     "Align top edges"],
                ["centerY", "alignMiddle",  "Align vertical centers"],
                ["bottom",  "alignBottom",  "Align bottom edges"],
              ] as [AlignEdge, string, string][]
            ).map(([edge, icon, tip]) => {
              // Align is enabled for 2+ elements when target=selection,
              // and for 1+ elements when targeting the page or a key object.
              const canAlign =
                alignTarget === "selection"
                  ? selection.length >= 2
                  : alignTarget === "key"
                    ? selection.length >= 2 && keyRef !== null
                    : selection.length >= 1;
              return (
                <Tooltip key={edge} label={tip}>
                  <button
                    type="button"
                    disabled={!canAlign}
                    onClick={() =>
                      mutate(
                        (p) =>
                          alignElements(p, selection, edge, {
                            target: alignTarget,
                            pageWIn: wIn,
                            pageHIn: hIn,
                            keyRef: keyRef ?? undefined,
                          }),
                        true,
                      )
                    }
                    className={ARRANGE_ICON_BTN}
                  >
                    <Icon name={icon as IconName} className="h-4 w-4" />
                  </button>
                </Tooltip>
              );
            })}

            {/* Divider */}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />

            {/* Distribute Objects (6 buttons) */}
            {(
              [
                ["left",    "distributeLeft",    "Distribute left edges"],
                ["centerX", "distributeCenterH", "Distribute horizontal centers"],
                ["right",   "distributeRight",   "Distribute right edges"],
                ["top",     "distributeTop",     "Distribute top edges"],
                ["centerY", "distributeCenterV", "Distribute vertical centers"],
                ["bottom",  "distributeBottom",  "Distribute bottom edges"],
              ] as [DistributeAnchor, string, string][]
            ).map(([anchor, icon, tip]) => (
              <Tooltip key={anchor} label={tip}>
                <button
                  type="button"
                  disabled={selection.length < 3}
                  onClick={() =>
                    mutate((p) => distributeElements(p, selection, anchor), true)
                  }
                  className={ARRANGE_ICON_BTN}
                >
                  <Icon name={icon as IconName} className="h-4 w-4" />
                </button>
              </Tooltip>
            ))}

            {/* Divider */}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />

            {/* Distribute Spacing (2 buttons + gap input) */}
            <Tooltip label="Distribute horizontal spacing">
              <button
                type="button"
                disabled={selection.length < 2}
                onClick={() =>
                  mutate((p) => distributeSpacing(p, selection, "horizontal", spacingGapIn), true)
                }
                className={ARRANGE_ICON_BTN}
              >
                <Icon name="distributeSpaceH" className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip label="Distribute vertical spacing">
              <button
                type="button"
                disabled={selection.length < 2}
                onClick={() =>
                  mutate((p) => distributeSpacing(p, selection, "vertical", spacingGapIn), true)
                }
                className={ARRANGE_ICON_BTN}
              >
                <Icon name="distributeSpaceV" className="h-4 w-4" />
              </button>
            </Tooltip>
            {/* Gap value input (inches) */}
            <Tooltip label="Gap between elements (inches)">
              <input
                type="number"
                min={0}
                step={0.05}
                value={spacingGapIn}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!Number.isNaN(v) && v >= 0) setSpacingGapIn(v);
                }}
                className="h-7 w-14 rounded border border-border-strong px-1.5 text-meta text-foreground focus:border-brand-action focus:outline-none"
                aria-label="Gap (in)"
              />
            </Tooltip>
            <span className="text-meta text-foreground-faint">in</span>

            {/* Divider */}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />

            {/* Align-to toggle (selection / page / key object) */}
            <Tooltip label="Align relative to selection">
              <button
                type="button"
                onClick={() => setAlignTarget("selection")}
                className={alignTarget === "selection" ? ARRANGE_ICON_BTN_ACTIVE : ARRANGE_ICON_BTN}
              >
                <Icon name="alignToSelection" className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip label="Align relative to page">
              <button
                type="button"
                onClick={() => setAlignTarget("page")}
                className={alignTarget === "page" ? ARRANGE_ICON_BTN_ACTIVE : ARRANGE_ICON_BTN}
              >
                <Icon name="alignToPage" className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip label="Align relative to key object (last element added to selection)">
              <button
                type="button"
                onClick={() => setAlignTarget("key")}
                className={alignTarget === "key" ? ARRANGE_ICON_BTN_ACTIVE : ARRANGE_ICON_BTN}
              >
                <Icon name="alignToKey" className="h-4 w-4" />
              </button>
            </Tooltip>

            {/* Divider */}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />

            {/* Flip (2 buttons) */}
            <Tooltip label="Flip horizontal">
              <button
                type="button"
                onClick={() => mutate((p) => flipElements(p, selection, "horizontal"), true)}
                className={ARRANGE_ICON_BTN}
              >
                <Icon name="flipH" className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip label="Flip vertical">
              <button
                type="button"
                onClick={() => mutate((p) => flipElements(p, selection, "vertical"), true)}
                className={ARRANGE_ICON_BTN}
              >
                <Icon name="flipV" className="h-4 w-4" />
              </button>
            </Tooltip>

            {/* Divider */}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />

            {/* Arrange / z-order (4 buttons) */}
            <Tooltip label="Bring to front">
              <button
                type="button"
                onClick={() => mutate((p) => selection.reduce((a, r) => bringToFront(a, r), p), true)}
                className={ARRANGE_ICON_BTN}
              >
                <Icon name="arrangeFront" className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip label="Bring forward">
              <button
                type="button"
                onClick={() => mutate((p) => selection.reduce((a, r) => bringForward(a, r), p), true)}
                className={ARRANGE_ICON_BTN}
              >
                <Icon name="arrangeForward" className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip label="Send backward">
              <button
                type="button"
                onClick={() => mutate((p) => selection.reduce((a, r) => sendBackward(a, r), p), true)}
                className={ARRANGE_ICON_BTN}
              >
                <Icon name="arrangeBackward" className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip label="Send to back">
              <button
                type="button"
                onClick={() => mutate((p) => selection.reduce((a, r) => sendToBack(a, r), p), true)}
                className={ARRANGE_ICON_BTN}
              >
                <Icon name="arrangeBack" className="h-4 w-4" />
              </button>
            </Tooltip>

            {/* Divider */}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />

            {/* Group / Ungroup (2 buttons) */}
            <Tooltip label="Group selected elements (Cmd+G)">
              <button
                type="button"
                disabled={selection.length < 2}
                onClick={() => {
                  const gid = `g${Date.now().toString(36)}`;
                  mutate((p) => setGroupId(p, selection, gid), true);
                }}
                className={ARRANGE_ICON_BTN}
              >
                <Icon name="groupElements" className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip label="Ungroup selected elements (Cmd+Shift+G)">
              <button
                type="button"
                onClick={() => mutate((p) => setGroupId(p, selection, null), true)}
                className={ARRANGE_ICON_BTN}
              >
                <Icon name="ungroupElements" className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
        )}
        {/* Shared pan/zoom viewport (same component the Phylo Studio + Data Hub use):
            two-finger pan, pinch / Cmd-wheel zoom-at-cursor, Space-drag, scrollbars,
            minimap. The stage is rendered at its natural fit size; the canvas zooms
            on top. Drag math reads the live on-screen scale via effScale(). */}
        <ZoomPanCanvas contentWidth={pageW} contentHeight={pageH} minimap={minimapStage}>
        <div
          ref={stageRef}
          className="relative bg-white shadow-lg"
          style={{ width: pageW, height: pageH }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("application/x-ros-asset")) e.preventDefault();
          }}
          onDrop={onCanvasDrop}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            // Empty-canvas press starts a marquee (rubber-band) select. A plain
            // click with no drag finalizes to an empty rect, which deselects.
            const rect = stageRef.current?.getBoundingClientRect();
            if (!rect) return;
            const s = effScale();
            marqueeRef.current = {
              sx: (e.clientX - rect.left) / s,
              sy: (e.clientY - rect.top) / s,
            };
            if (!e.shiftKey) clearSel();
          }}
        >
          {/* Shapes layer (rectangles / ellipses), below panels as backgrounds. */}
          {visibleShapes(page).map((s) => {
            const ref: ElementRef = { kind: "shape", id: s.shapeId };
            const sel = isSelectedRef(ref);
            const locked = !!s.locked;
            const px = s.xIn * scale;
            const py = s.yIn * scale;
            const pw = s.wIn * scale;
            const ph = s.hIn * scale;
            const tf = elementTransformCss(px, py, pw, ph, { rotation: s.rotation, flipX: s.flipX, flipY: s.flipY });
            return (
              <div
                key={s.shapeId}
                className={`absolute ${s.kind === "ellipse" ? "rounded-full" : "rounded-sm"} ${sel ? "outline outline-2 outline-brand-action" : "outline outline-1 outline-transparent hover:outline-border-strong"}`}
                style={{
                  left: px,
                  top: py,
                  width: pw,
                  height: ph,
                  background: s.fill === "none" ? "transparent" : s.fill,
                  border:
                    s.stroke === "none"
                      ? undefined
                      : `${Math.max(1, (s.strokeWPt * scale) / 72)}px solid ${s.stroke}`,
                  cursor: locked ? "default" : "grab",
                  transform: tf || undefined,
                  opacity: locked ? 0.7 : 1,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => onShapeDown(e, s.shapeId, false)}
                data-testid="figure-shape"
              >
                {selection.length === 1 && sel && !locked && (
                  <div
                    className="absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-sm border-2 border-brand-action bg-white"
                    style={{ cursor: "nwse-resize" }}
                    onMouseDown={(e) => onShapeDown(e, s.shapeId, true)}
                  />
                )}
              </div>
            );
          })}
          {visiblePanels(page).map((p) => {
            const ref: ElementRef = { kind: "panel", id: p.panelId };
            const sel = isSelectedRef(ref);
            const locked = !!p.locked;
            const lab = labels.get(p.panelId);
            const px = p.xIn * scale;
            const py = p.yIn * scale;
            const pw = p.wIn * scale;
            const ph = p.hIn * scale;
            const tf = elementTransformCss(px, py, pw, ph, { flipX: p.flipX, flipY: p.flipY });
            return (
              <div
                key={p.panelId}
                className={`absolute overflow-hidden ${sel ? "outline outline-2 outline-brand-action" : "outline outline-1 outline-transparent hover:outline-border-strong"}`}
                style={{
                  left: px,
                  top: py,
                  width: pw,
                  height: ph,
                  cursor: locked ? "default" : "grab",
                  transform: tf || undefined,
                  opacity: locked ? 0.7 : 1,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => onPanelDown(e, p.panelId, false)}
                data-testid="figure-panel"
              >
                <div
                  className="pointer-events-none h-full w-full [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{
                    __html: panelSvgs.get(p.panelId) ?? "",
                  }}
                />
                {lab && (
                  <span
                    className="absolute left-1 top-0.5 rounded bg-white/70 px-1 font-bold text-foreground"
                    style={{ fontSize: Math.max(10, 0.16 * scale) }}
                  >
                    {lab}
                  </span>
                )}
                {selection.length === 1 && sel && !locked && (
                  <div
                    className="absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-sm border-2 border-brand-action bg-white"
                    style={{ cursor: "nwse-resize" }}
                    onMouseDown={(e) => onPanelDown(e, p.panelId, true)}
                  />
                )}
              </div>
            );
          })}
          {page.panels.length === 0 &&
            pageAssets(page).length === 0 &&
            pageShapes(page).length === 0 &&
            page.annotations.length === 0 &&
            pageConnectors(page).length === 0 && (
              <div className="flex h-full items-center justify-center text-meta text-foreground-faint">
                Add a figure, icon, shape, or template to start the page.
              </div>
            )}

          {/* Placed library assets (icons), draggable + resizable, above panels. */}
          {visibleAssets(page).map((a) => {
            const ref: ElementRef = { kind: "asset", id: a.assetId };
            const sel = isSelectedRef(ref);
            const locked = !!a.locked;
            const raw = assetSvgs.get(a.assetId) ?? "";
            const display = raw ? recolorPlacedAsset(raw, a) : raw;
            const px = a.xIn * scale;
            const py = a.yIn * scale;
            const pw = a.wIn * scale;
            const ph = a.hIn * scale;
            const tf = elementTransformCss(px, py, pw, ph, { rotation: a.rotation, flipX: a.flipX, flipY: a.flipY });
            return (
              <div
                key={a.assetId}
                className={`absolute ${sel ? "outline outline-2 outline-brand-action" : "outline outline-1 outline-transparent hover:outline-border-strong"}`}
                style={{
                  left: px,
                  top: py,
                  width: pw,
                  height: ph,
                  cursor: locked ? "default" : "grab",
                  transform: tf || undefined,
                  opacity: locked ? 0.7 : 1,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => onAssetDown(e, a.assetId, false)}
                data-testid="figure-asset"
              >
                <div
                  className="pointer-events-none h-full w-full [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: display }}
                />
                {selection.length === 1 && sel && !locked && (
                  <div
                    className="absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-sm border-2 border-brand-action bg-white"
                    style={{ cursor: "nwse-resize" }}
                    onMouseDown={(e) => onAssetDown(e, a.assetId, true)}
                  />
                )}
              </div>
            );
          })}

          {/* Smart-connector layer. Built as an injected SVG STRING (so the
              component carries no inline svg element, per house style); paths
              resolve live from element boxes and reroute on move. A delegated
              mousedown reads data-conn-id to select a connector. */}
          <div
            className="absolute inset-0"
            style={{ pointerEvents: "none" }}
            onMouseDown={(e) => {
              const id = (e.target as Element)
                .closest?.("[data-conn-id]")
                ?.getAttribute("data-conn-id");
              if (!id) return;
              e.stopPropagation();
              setSelection([]);
              setSelectedConn(id);
            }}
            dangerouslySetInnerHTML={{
              __html: connectorLayerSvg(page, scale, {
                selectedConn,
                rubber:
                  connDraw.current && connCursor
                    ? { from: connDraw.current.startIn, to: connCursor }
                    : null,
              }),
            }}
          />

          {/* Anchor nodes (Connect tool): drag one to another element to connect. */}
          {tool === "connect" &&
            listElements(page).map((ref) => {
              const b = elementBox(page, ref);
              if (!b) return null;
              return elementAnchors(b).map((an) => (
                <div
                  key={`${ref.kind}-${ref.id}-${an.side}`}
                  className="absolute z-30 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-action shadow"
                  style={{ left: an.point.xIn * scale, top: an.point.yIn * scale, cursor: "crosshair" }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    connDraw.current = { from: { ref, side: an.side }, startIn: an.point };
                    setConnCursor(an.point);
                  }}
                />
              ));
            })}

          {/* Annotation layer, painted above the panels (one injected SVG string,
              so the component carries no inline SVG of its own). Click-through. */}
          <div
            className="pointer-events-none absolute inset-0"
            dangerouslySetInnerHTML={{ __html: annotationLayerSvg(page, scale) }}
          />

          {/* Interaction targets for select + drag (only when not placing). */}
          {!tool &&
            visibleAnnotations(page).map((a) => {
              const b = annBox(a, scale);
              const sel = isSelectedRef({ kind: "annotation", id: a.annId });
              const locked = !!a.locked;
              return (
                <div
                  key={a.annId}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => onAnnDown(e, a.annId)}
                  className="absolute"
                  style={{
                    left: b.x - 4,
                    top: b.y - 4,
                    width: b.w + 8,
                    height: b.h + 8,
                    cursor: locked ? "default" : "move",
                    borderRadius: 3,
                    border: sel ? "1px dashed #2563eb" : "1px solid transparent",
                    opacity: locked ? 0.7 : 1,
                  }}
                />
              );
            })}

          {/* Placement capture overlay (annotation tools only, NOT connect: the
              connect tool needs the anchor nodes to receive the press). */}
          {tool && tool !== "connect" && (
            <div
              className="absolute inset-0 z-10"
              style={{ cursor: "crosshair" }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => {
                e.stopPropagation();
                const rect = stageRef.current?.getBoundingClientRect();
                if (!rect) return;
                const s = effScale();
                placeAnnotation((e.clientX - rect.left) / s, (e.clientY - rect.top) / s);
              }}
            />
          )}

          {/* Smart-guide alignment lines while dragging (drawn full-page). */}
          {guides.map((g, i) =>
            g.axis === "x" ? (
              <div
                key={`gx${i}`}
                className="pointer-events-none absolute z-20 bg-brand-action"
                style={{ left: g.atIn * scale, top: 0, width: 1, height: pageH }}
              />
            ) : (
              <div
                key={`gy${i}`}
                className="pointer-events-none absolute z-20 bg-brand-action"
                style={{ left: 0, top: g.atIn * scale, width: pageW, height: 1 }}
              />
            ),
          )}

          {/* Marquee (rubber-band) selection rectangle. */}
          {marquee && (
            <div
              className="pointer-events-none absolute z-20 border border-brand-action bg-brand-action/10"
              style={{
                left: marquee.xIn * scale,
                top: marquee.yIn * scale,
                width: marquee.wIn * scale,
                height: marquee.hIn * scale,
              }}
            />
          )}
        </div>
        </ZoomPanCanvas>
      </div>

      <div className="w-72 shrink-0 space-y-4 overflow-auto">
        <div className="flex flex-wrap gap-2">
          <Tooltip label="Arrange every panel into a clean grid (undoable).">
            <button
              type="button"
              onClick={() => mutate((p) => snapToGrid(p, "align"), true)}
              className="rounded-lg border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-brand-action"
            >
              Snap to grid
            </button>
          </Tooltip>
          <Tooltip label="Undo the last layout change.">
            <button
              type="button"
              onClick={doUndo}
              disabled={undo.length === 0}
              className="rounded-lg border border-border-strong px-2.5 py-1.5 text-meta font-semibold hover:border-brand-action disabled:opacity-40"
            >
              <Icon name="undo" className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>

        <div className="rounded-xl border border-border p-3">
          <h3 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-faint">Page</h3>
          <label className="mb-2 flex items-center justify-between text-body">
            <span className="text-foreground-muted">Paper</span>
            <select
              value={page.paper.paperId}
              onChange={(e) =>
                mutate(
                  (p) => fitPanelsToPage({ ...p, paper: { ...p.paper, paperId: e.target.value } }),
                  true,
                )
              }
              className="rounded-md border border-border bg-surface px-2 py-1 text-meta"
            >
              {PAPER_PRESETS.map((pp) => (
                <option key={pp.id} value={pp.id}>
                  {pp.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between text-body">
            <span className="text-foreground-muted">Labels</span>
            <div className="inline-flex overflow-hidden rounded-md border border-border-strong">
              {(["ABC", "abc", "123", "none"] as LabelStyle[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => mutate((p) => ({ ...p, labelStyle: s }))}
                  className={`px-2 py-1 text-meta ${page.labelStyle === s ? "bg-brand-action text-white" : "text-foreground-muted"}`}
                >
                  {s === "none" ? "None" : s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Numeric transform inspector: shows for any single selected element. */}
        {single && (() => {
          const box = elementBox(page, single);
          if (!box) return null;
          const locked = isElementLocked(page, single);
          const hidden = isElementHidden(page, single);
          // Rotation only applies to assets and shapes.
          const rotation =
            single.kind === "asset"
              ? pageAssets(page).find((a) => a.assetId === single.id)?.rotation ?? 0
              : single.kind === "shape"
                ? (pageShapes(page).find((s) => s.shapeId === single.id)?.rotation ?? 0)
                : null;

          const fmt = (v: number) => (Math.round(v * 1000) / 1000).toString();

          const onField = (field: "x" | "y" | "w" | "h", raw: string) => {
            const v = parseFloat(raw);
            if (!isFinite(v)) return;
            if (field === "x" || field === "y") {
              const dx = field === "x" ? v - box.xIn : 0;
              const dy = field === "y" ? v - box.yIn : 0;
              mutate((p) => translateElement(p, single, dx, dy), true);
            } else {
              const wIn = field === "w" ? v : box.wIn;
              const hIn = field === "h" ? v : box.hIn;
              mutate((p) => setElementSize(p, single, wIn, hIn), true);
            }
          };

          return (
            <div className="rounded-xl border border-border p-3">
              <h3 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-faint">
                Transform
              </h3>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ["X", "x", box.xIn],
                    ["Y", "y", box.yIn],
                    ["W", "w", box.wIn],
                    ["H", "h", box.hIn],
                  ] as [string, "x" | "y" | "w" | "h", number][]
                ).map(([lbl, fld, val]) => (
                  <label key={fld} className="flex items-center gap-1 text-meta text-foreground-muted">
                    <span className="w-4 shrink-0 font-semibold">{lbl}:</span>
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={fmt(val)}
                      key={`${fld}-${fmt(val)}`}
                      onBlur={(e) => onField(fld, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") onField(fld, (e.target as HTMLInputElement).value); }}
                      className="w-full rounded-md border border-border bg-surface px-1.5 py-0.5 text-meta"
                    />
                  </label>
                ))}
              </div>
              {rotation !== null && (
                <label className="mt-1.5 flex items-center gap-1 text-meta text-foreground-muted">
                  <span className="w-4 shrink-0 font-semibold">R:</span>
                  <input
                    type="number"
                    step="1"
                    min={0}
                    max={360}
                    defaultValue={Math.round(rotation)}
                    key={`rot-${Math.round(rotation)}`}
                    onBlur={(e) => {
                      const v = parseFloat(e.target.value);
                      if (isFinite(v)) mutate((p) => setElementRotation(p, single, v % 360), true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const v = parseFloat((e.target as HTMLInputElement).value);
                        if (isFinite(v)) mutate((p) => setElementRotation(p, single, v % 360), true);
                      }
                    }}
                    className="w-full rounded-md border border-border bg-surface px-1.5 py-0.5 text-meta"
                  />
                  <span className="text-[10px] text-foreground-faint">deg</span>
                </label>
              )}
              <div className="mt-2 flex gap-2">
                <Tooltip label={locked ? "Locked: click to unlock" : "Lock this element to prevent accidental moves"}>
                  <button
                    type="button"
                    onClick={() => mutate((p) => setElementLocked(p, single, !locked), true)}
                    className={`flex items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium ${locked ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong text-foreground-muted hover:border-brand-action"}`}
                  >
                    <Icon name={locked ? "lock" : "lockOpen"} className="h-3.5 w-3.5" />
                    {locked ? "Locked" : "Lock"}
                  </button>
                </Tooltip>
                <Tooltip label={hidden ? "Hidden: click to show on canvas and in export" : "Hide this element from the canvas and export"}>
                  <button
                    type="button"
                    onClick={() => mutate((p) => setElementHidden(p, single, !hidden), true)}
                    className={`flex items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium ${hidden ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong text-foreground-muted hover:border-brand-action"}`}
                  >
                    <Icon name={hidden ? "eyeOff" : "eye"} className="h-3.5 w-3.5" />
                    {hidden ? "Hidden" : "Hide"}
                  </button>
                </Tooltip>
              </div>
            </div>
          );
        })()}

        <div className="rounded-xl border border-border p-3">
          <h3 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-faint">
            Annotate
          </h3>
          <div className="flex gap-2">
            {(
              [
                ["text", "Text"],
                ["arrow", "Arrow"],
                ["bracket", "Bracket"],
              ] as const
            ).map(([t, lbl]) => (
              <Tooltip key={t} label={lbl}>
                <button
                  type="button"
                  aria-label={lbl}
                  onClick={() => setTool(tool === t ? null : t)}
                  className={`flex flex-1 items-center justify-center rounded-lg border px-2 py-2 ${tool === t ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong text-foreground-muted hover:border-brand-action"}`}
                >
                  <Icon name={t as IconName} className="h-4 w-4" />
                </button>
              </Tooltip>
            ))}
          </div>
          {/* Typed-text picker: choose the semantic style the Text tool places. */}
          {tool === "text" && (
            <div className="mt-2 flex gap-1">
              {(["heading", "label", "body"] as TextVariant[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTextVariant(v)}
                  className={`flex-1 rounded border px-1.5 py-1 text-meta capitalize ${textVariant === v ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong hover:border-brand-action"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
          {tool && tool !== "connect" && (
            <p className="mt-2 text-meta text-foreground-faint">
              {tool === "text"
                ? `Click the page to place a ${textVariant}.`
                : `Click the page to place the ${tool}.`}
            </p>
          )}
        </div>

        {/* Smart connectors (Phase 2): the connect tool + the selected-connector
            inspector. The connector itself anchors to elements and reroutes on move. */}
        <div className="rounded-xl border border-border p-3">
          <h3 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-faint">
            Connect
          </h3>
          <Tooltip label={tool === "connect" ? "Connecting (drag node to node)" : "Smart connector"}>
            <button
              type="button"
              aria-label="Smart connector"
              onClick={() => setTool(tool === "connect" ? null : "connect")}
              className={`flex items-center justify-center rounded-lg border px-3 py-2 ${tool === "connect" ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong text-foreground-muted hover:border-brand-action"}`}
            >
              <Icon name="connector" className="h-4 w-4" />
            </button>
          </Tooltip>
          {tool === "connect" && (
            <p className="mt-2 text-meta text-foreground-faint">
              Drag from a blue node on one element onto another element to connect them.
            </p>
          )}

          {selectedConnObj && (
            <div className="mt-3 space-y-2.5 border-t border-border pt-3">
              <div className="flex gap-1">
                {(["straight", "elbow", "curve"] as ConnectorShape[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => mutate((p) => updateConnector(p, selectedConnObj.connId, { shape: s }), true)}
                    className={`flex-1 rounded border px-1.5 py-1 text-meta capitalize ${selectedConnObj.shape === s ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong hover:border-brand-action"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {([["None", 0], ["End", 1], ["Both", 2]] as [string, 0 | 1 | 2][]).map(([lbl, h]) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => mutate((p) => updateConnector(p, selectedConnObj.connId, { heads: h }), true)}
                    className={`flex-1 rounded border px-1.5 py-1 text-meta ${selectedConnObj.heads === h ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong hover:border-brand-action"}`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={selectedConnObj.color}
                  onChange={(e) => mutate((p) => updateConnector(p, selectedConnObj.connId, { color: e.target.value }), true)}
                  className="h-7 w-9 cursor-pointer rounded border border-border-strong"
                />
                <span className="text-meta text-foreground-muted">Weight</span>
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.5}
                  value={selectedConnObj.weightPt}
                  onChange={(e) => mutate((p) => updateConnector(p, selectedConnObj.connId, { weightPt: Number(e.target.value) }), true)}
                  className="flex-1"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  mutate((p) => removeConnector(p, selectedConnObj.connId), true);
                  setSelectedConn(null);
                }}
                className="block text-meta font-medium text-pin hover:underline"
              >
                Remove connector
              </button>
            </div>
          )}
        </div>

        {/* Bulk actions on a multi-selection (Phase 3): recolor every selected icon
            at once, the fastest way to make a figure's icons look coherent. */}
        {selection.length >= 2 && (
          <div className="rounded-xl border border-border p-3">
            <h3 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-faint">
              {selection.length} selected
            </h3>
            {selAssetIds.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-meta text-foreground-muted">
                  Recolor {selAssetIds.length} icon{selAssetIds.length === 1 ? "" : "s"}
                </span>
                {["", "#2563eb", "#16a34a", "#dc2626", "#b9770f", "#6d28d9", "#0f172a"].map((c) => (
                  <button
                    key={c || "none"}
                    type="button"
                    aria-label={c ? `Recolor all to ${c}` : "Reset all to original"}
                    onClick={() =>
                      mutate((p) => {
                        let np = p;
                        for (const id of selAssetIds) {
                          // Brand logos keep their original colors; never bulk-recolor them.
                          const placed = pageAssets(p).find((x) => x.assetId === id);
                          if (placed?.isLogo) continue;
                          np = updatePlacedAsset(np, id, { tint: c || undefined, fillTints: undefined });
                        }
                        return np;
                      }, true)
                    }
                    className="h-5 w-5 rounded border border-border"
                    style={c ? { background: c } : undefined}
                    title={c ? c : "Original colors"}
                  >
                    {c ? "" : <Icon name="close" className="h-3 w-3 text-foreground-muted" />}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-meta text-foreground-faint">
                Use the bar above the canvas to align, distribute, or reorder.
              </p>
            )}
          </div>
        )}

        {selected &&
          (() => {
            const sp = page.panels.find((x) => x.panelId === selected);
            const titleShown = sp?.overrides?.hideTitle === false;
            const src = getFigureSource(sp?.ref.type ?? "");
            // Source-specific option controls, declared by the source so the
            // inspector renders them with no per-source special-casing.
            const styleSchema = src?.styleSchema?.() ?? [];
            return (
              <div className="space-y-2.5 rounded-xl border border-border p-3">
                <h3 className="text-meta font-bold uppercase tracking-wide text-foreground-faint">
                  Selected panel
                </h3>
                <label className="flex items-center gap-2 text-meta text-foreground-muted">
                  <input
                    type="checkbox"
                    checked={titleShown}
                    onChange={(e) => {
                      const show = e.target.checked;
                      mutate(
                        (pg) => ({
                          ...pg,
                          panels: pg.panels.map((pp) =>
                            pp.panelId === selected
                              ? { ...pp, overrides: { ...pp.overrides, hideTitle: !show } }
                              : pp,
                          ),
                        }),
                        true,
                      );
                    }}
                  />
                  Show plot title
                </label>

                {/* Collision-aware layout advisor (Phase 5): flags a legend over
                    the data / crowded labels AT THIS PANEL SIZE and applies a fix
                    as a panel-local override. Renders nothing when the panel is
                    clean or its source has no manifest. The Style controls below
                    are the persistent revert. */}
                {src && sp && (
                  <CompositionPanelAdvisor
                    panelId={selected}
                    source={src}
                    refId={sp.ref.id}
                    widthIn={sp.wIn}
                    heightIn={sp.hIn}
                    style={sp.style}
                    onApply={(patch) =>
                      mutate((p) => setPanelStyle(p, selected, patch), true)
                    }
                  />
                )}

                {(styleTargets.length > 0 || styleSchema.length > 0) && (
                  <div className="space-y-2 border-t border-border pt-2.5">
                    <p className="text-meta font-semibold text-foreground-muted">Style</p>
                    {styleTargets.length > 0 && (
                    <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                      {styleTargets.map((t) => {
                        const ov = sp?.style?.targets?.[t.key];
                        const color = ov?.color ?? t.color ?? "#888888";
                        const hidden = ov?.hidden === true;
                        return (
                          <div key={t.key} className="flex items-center gap-2">
                            <input
                              type="color"
                              value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#888888"}
                              onChange={(e) =>
                                mutate((p) => setPanelTarget(p, selected, t.key, { color: e.target.value }))
                              }
                              className="h-5 w-5 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                              aria-label={`Color of ${t.label}`}
                            />
                            <span
                              className={`flex-1 truncate text-meta ${hidden ? "text-foreground-faint line-through" : "text-foreground"}`}
                            >
                              {t.label}
                            </span>
                            <button
                              type="button"
                              aria-label={hidden ? `Show ${t.label}` : `Hide ${t.label}`}
                              onClick={() =>
                                mutate((p) => setPanelTarget(p, selected, t.key, { hidden: !hidden }), true)
                              }
                              className="shrink-0 text-foreground-faint hover:text-foreground"
                            >
                              <Icon name={hidden ? "eyeOff" : "eye"} className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    )}
                    {styleSchema.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {styleSchema.map((opt) => {
                          const cur = sp?.style?.options?.[opt.key];
                          if (opt.kind === "range") {
                            return (
                              <label
                                key={opt.key}
                                className="flex items-center justify-between gap-2 text-meta text-foreground-muted"
                              >
                                <span>{opt.label}</span>
                                <input
                                  type="range"
                                  min={opt.min}
                                  max={opt.max}
                                  step={opt.step}
                                  value={typeof cur === "number" ? cur : opt.default}
                                  onChange={(e) =>
                                    mutate((p) =>
                                      setPanelStyle(p, selected, {
                                        options: { [opt.key]: Number(e.target.value) },
                                      }),
                                    )
                                  }
                                  className="w-28"
                                />
                              </label>
                            );
                          }
                          if (opt.kind === "toggle") {
                            return (
                              <label
                                key={opt.key}
                                className="flex items-center gap-2 text-meta text-foreground-muted"
                              >
                                <input
                                  type="checkbox"
                                  checked={typeof cur === "boolean" ? cur : opt.default}
                                  onChange={(e) =>
                                    mutate(
                                      (p) =>
                                        setPanelStyle(p, selected, {
                                          options: { [opt.key]: e.target.checked },
                                        }),
                                      true,
                                    )
                                  }
                                />
                                {opt.label}
                              </label>
                            );
                          }
                          return (
                            <label
                              key={opt.key}
                              className="flex items-center justify-between gap-2 text-meta text-foreground-muted"
                            >
                              <span>{opt.label}</span>
                              <select
                                value={typeof cur === "string" ? cur : opt.default}
                                onChange={(e) =>
                                  mutate(
                                    (p) =>
                                      setPanelStyle(p, selected, {
                                        options: { [opt.key]: e.target.value },
                                      }),
                                    true,
                                  )
                                }
                                className="max-w-[10rem] rounded border border-border bg-transparent px-1 py-0.5 text-meta"
                              >
                                {opt.choices.map((c) => (
                                  <option key={c.value} value={c.value}>
                                    {c.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {src?.saveDefaultStyle && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!sp) return;
                          await src.saveDefaultStyle?.(sp.ref.id, sp.style ?? {});
                          setDefaultSaved(true);
                        }}
                        className="mt-1 flex items-center gap-1 text-meta font-medium text-brand-action hover:underline"
                      >
                        {defaultSaved && <Icon name="check" className="h-3 w-3" />}
                        {defaultSaved ? "Saved as default" : "Save as this figure's default"}
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    mutate((p) => pruneConnectors(removePanel(p, selected)), true);
                    clearSel();
                  }}
                  className="block text-meta font-medium text-pin hover:underline"
                >
                  Remove from page
                </button>
              </div>
            );
          })()}

        {selectedAnnotation && (
          <div className="space-y-2.5 rounded-xl border border-border p-3">
            <h3 className="text-meta font-bold uppercase tracking-wide text-foreground-faint">
              Annotation
            </h3>
            {selectedAnnotation.kind === "text" && (
              <>
                <input
                  type="text"
                  value={selectedAnnotation.text}
                  onChange={(e) =>
                    mutate((p) => updateAnnotation(p, selectedAnnotation.annId, { text: e.target.value }))
                  }
                  placeholder="Text"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-meta"
                />
                <div className="flex gap-1">
                  {(["heading", "label", "body"] as TextVariant[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() =>
                        mutate((p) =>
                          updateAnnotation(p, selectedAnnotation.annId, {
                            variant: v,
                            fontPt: TEXT_VARIANT_PT[v],
                          }),
                        )
                      }
                      className={`flex-1 rounded border px-1.5 py-1 text-meta capitalize ${(selectedAnnotation.variant ?? "label") === v ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong hover:border-brand-action"}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </>
            )}
            {selectedAnnotation.kind === "arrow" && (
              <div className="flex items-center justify-between text-body">
                <span className="text-foreground-muted">Heads</span>
                <div className="inline-flex overflow-hidden rounded-md border border-border-strong">
                  {(
                    [
                      [0, "Line"],
                      [1, "Arrow"],
                      [2, "Double"],
                    ] as const
                  ).map(([h, lbl]) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() =>
                        mutate((p) => updateAnnotation(p, selectedAnnotation.annId, { heads: h }), true)
                      }
                      className={`px-2 py-1 text-meta ${selectedAnnotation.heads === h ? "bg-brand-action text-white" : "text-foreground-muted"}`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {selectedAnnotation.kind === "bracket" && (
              <>
                <input
                  type="text"
                  value={selectedAnnotation.label ?? ""}
                  onChange={(e) =>
                    mutate((p) => updateAnnotation(p, selectedAnnotation.annId, { label: e.target.value }))
                  }
                  placeholder="Label (e.g. ** or p = 0.03)"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-meta"
                />
                <div className="flex items-center justify-between text-body">
                  <span className="text-foreground-muted">Orientation</span>
                  <div className="inline-flex overflow-hidden rounded-md border border-border-strong">
                    {(["horizontal", "vertical"] as const).map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() =>
                          mutate(
                            (p) => updateAnnotation(p, selectedAnnotation.annId, { orientation: o }),
                            true,
                          )
                        }
                        className={`px-2 py-1 text-meta capitalize ${selectedAnnotation.orientation === o ? "bg-brand-action text-white" : "text-foreground-muted"}`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                mutate((p) => pruneConnectors(removeAnnotation(p, selectedAnnotation.annId)), true);
                clearSel();
              }}
              className="block text-meta font-medium text-pin hover:underline"
            >
              Remove annotation
            </button>
          </div>
        )}

        {/* Selected placed-asset (icon) inspector. */}
        {selectedAssetObj && (
          <div className="rounded-xl border border-border p-3" data-testid="figure-asset-inspector">
            <h3 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-faint">
              Selected icon
            </h3>
            {/* Brand logos keep their original colors, so the recolor UI is hidden. */}
            {selectedAssetObj.isLogo ? (
              <p className="mb-2 text-meta text-foreground-faint">
                Brand logo. Colors are locked to preserve the trademark. You can place, resize, rotate, and flip it.
              </p>
            ) : (
              <>
            {/* Recolor: whole-icon single tint, or per-fill (multi-part) recolor. */}
            <div className="mb-2 flex overflow-hidden rounded-lg border border-border-strong text-meta">
              {(["whole", "part"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRecolorMode(m)}
                  className={`flex-1 px-2 py-1 font-medium ${recolorMode === m ? "bg-brand-action/10 text-brand-action" : "text-foreground-muted hover:bg-surface-sunken"}`}
                >
                  {m === "whole" ? "Whole icon" : "By part"}
                </button>
              ))}
            </div>

            {recolorMode === "whole" ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {["", "#2563eb", "#16a34a", "#dc2626", "#b9770f", "#6d28d9", "#0f172a"].map((c) => {
                  const active = !selectedAssetObj.fillTints && (selectedAssetObj.tint ?? "") === c;
                  return (
                    <button
                      key={c || "none"}
                      type="button"
                      aria-label={c ? `Tint ${c}` : "Original colors"}
                      onClick={() =>
                        mutate((p) =>
                          updatePlacedAsset(p, selectedAssetObj.assetId, {
                            tint: c || undefined,
                            fillTints: undefined,
                          }),
                        )
                      }
                      className={`h-5 w-5 rounded border ${active ? "ring-2 ring-brand-action" : "border-border"}`}
                      style={c ? { background: c } : undefined}
                      title={c ? c : "Original colors"}
                    >
                      {c ? "" : <Icon name="close" className="h-3 w-3 text-foreground-muted" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              (() => {
                const raw = assetSvgs.get(selectedAssetObj.assetId) ?? "";
                const fills = extractFills(raw);
                if (fills.length === 0) {
                  return (
                    <p className="text-meta text-foreground-faint">
                      This icon is a single shape. Use Whole icon to tint it.
                    </p>
                  );
                }
                return (
                  <div className="space-y-1.5">
                    {fills.map((f, i) => {
                      const cur = selectedAssetObj.fillTints?.[f] ?? f;
                      return (
                        <div key={`${f}-${i}`} className="flex items-center gap-2">
                          <input
                            type="color"
                            value={toHex6(cur)}
                            onChange={(e) =>
                              mutate((p) =>
                                updatePlacedAsset(p, selectedAssetObj.assetId, {
                                  tint: undefined,
                                  fillTints: { ...(selectedAssetObj.fillTints ?? {}), [f]: e.target.value },
                                }),
                              )
                            }
                            className="h-6 w-9 cursor-pointer rounded border border-border-strong"
                            aria-label={`Recolor part ${i + 1}`}
                          />
                          <span className="truncate text-meta text-foreground-muted">{f}</span>
                        </div>
                      );
                    })}
                    {selectedAssetObj.fillTints && (
                      <button
                        type="button"
                        onClick={() =>
                          mutate((p) =>
                            updatePlacedAsset(p, selectedAssetObj.assetId, { fillTints: undefined }),
                          )
                        }
                        className="text-meta font-medium text-brand-action hover:underline"
                      >
                        Reset colors
                      </button>
                    )}
                  </div>
                );
              })()
            )}
              </>
            )}
            <label className="mt-3 flex items-center justify-between gap-2 text-meta text-foreground-muted">
              <span>Rotate</span>
              <input
                type="range"
                min={0}
                max={360}
                step={15}
                value={selectedAssetObj.rotation ?? 0}
                onChange={(e) =>
                  mutate((p) =>
                    updatePlacedAsset(p, selectedAssetObj.assetId, { rotation: Number(e.target.value) || undefined }),
                  )
                }
                className="w-32"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                mutate((p) => pruneConnectors(removePlacedAsset(p, selectedAssetObj.assetId)), true);
                clearSel();
              }}
              className="mt-2 block text-meta font-medium text-pin hover:underline"
            >
              Remove from page
            </button>
          </div>
        )}

        {selectedShapeObj && (
          <div className="space-y-2.5 rounded-xl border border-border p-3" data-testid="figure-shape-inspector">
            <h3 className="text-meta font-bold uppercase tracking-wide text-foreground-faint">
              Selected {selectedShapeObj.kind}
            </h3>
            <div className="flex items-center gap-2 text-meta">
              <span className="w-12 text-foreground-muted">Fill</span>
              <input
                type="color"
                value={toHex6(selectedShapeObj.fill === "none" ? "#ffffff" : selectedShapeObj.fill)}
                onChange={(e) =>
                  mutate((p) => updateShape(p, selectedShapeObj.shapeId, { fill: e.target.value }))
                }
                className="h-6 w-9 cursor-pointer rounded border border-border-strong"
              />
              <button
                type="button"
                onClick={() => mutate((p) => updateShape(p, selectedShapeObj.shapeId, { fill: "none" }))}
                className={`rounded border px-1.5 py-0.5 ${selectedShapeObj.fill === "none" ? "border-brand-action text-brand-action" : "border-border-strong text-foreground-muted"}`}
              >
                None
              </button>
            </div>
            <div className="flex items-center gap-2 text-meta">
              <span className="w-12 text-foreground-muted">Stroke</span>
              <input
                type="color"
                value={toHex6(selectedShapeObj.stroke === "none" ? "#000000" : selectedShapeObj.stroke)}
                onChange={(e) =>
                  mutate((p) => updateShape(p, selectedShapeObj.shapeId, { stroke: e.target.value }))
                }
                className="h-6 w-9 cursor-pointer rounded border border-border-strong"
              />
              <button
                type="button"
                onClick={() => mutate((p) => updateShape(p, selectedShapeObj.shapeId, { stroke: "none" }))}
                className={`rounded border px-1.5 py-0.5 ${selectedShapeObj.stroke === "none" ? "border-brand-action text-brand-action" : "border-border-strong text-foreground-muted"}`}
              >
                None
              </button>
            </div>
            <label className="flex items-center justify-between gap-2 text-meta text-foreground-muted">
              <span>Stroke width</span>
              <input
                type="range"
                min={0.5}
                max={6}
                step={0.5}
                value={selectedShapeObj.strokeWPt}
                onChange={(e) =>
                  mutate((p) =>
                    updateShape(p, selectedShapeObj.shapeId, { strokeWPt: Number(e.target.value) }),
                  )
                }
                className="w-32"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                mutate((p) => pruneConnectors(removeShape(p, selectedShapeObj.shapeId)), true);
                clearSel();
              }}
              className="block text-meta font-medium text-pin hover:underline"
            >
              Remove from page
            </button>
          </div>
        )}

        <div className="rounded-xl border border-border p-3">
          <h3 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-faint">Export</h3>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={exportSvg}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-brand-action"
              data-testid="figure-export"
            >
              <Icon name="download" className="h-3.5 w-3.5" /> Export SVG
            </button>
            <Tooltip label="Export a rasterized PNG at 300 dpi. Hidden elements are excluded.">
              <button
                type="button"
                onClick={exportPng}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-brand-action"
                data-testid="figure-export-png"
              >
                <Icon name="download" className="h-3.5 w-3.5" /> Export PNG (300 dpi)
              </button>
            </Tooltip>
            <Tooltip label="Export a true vector PDF sized to the artboard dimensions. Hidden elements are excluded.">
              <button
                type="button"
                onClick={() => void exportPdf()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-brand-action"
                data-testid="figure-export-pdf"
              >
                <Icon name="download" className="h-3.5 w-3.5" /> Export PDF (vector)
              </button>
            </Tooltip>
          </div>
          <p className="mt-2 text-meta text-foreground-faint">
            {page.panels.length} panel{page.panels.length === 1 ? "" : "s"} at {wIn} x {hIn} in.
          </p>
          {credits.length > 0 && (
            <div className="mt-3 border-t border-border pt-2" data-testid="figure-credits">
              <p className="text-meta font-semibold text-foreground-muted">Figure credits</p>
              <ul className="mt-1 space-y-1">
                {credits.map((c) => (
                  <li key={c} className="text-[10px] leading-snug text-foreground-faint">
                    {c}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(credits.join("\n"))}
                className="mt-1 text-meta font-medium text-brand-action hover:underline"
              >
                Copy credits
              </button>
            </div>
          )}
        </div>
      </div>

      {pickerOpen && (
        <AddFigurePicker
          collectionId={page.collectionId}
          onClose={() => setPickerOpen(false)}
          onPickMany={(refs) => {
            if (refs.length === 0) {
              setPickerOpen(false);
              return;
            }
            const stamp = Date.now().toString(36);
            mutate((p) => {
              let next = p;
              refs.forEach((ref, i) => {
                next = addPanel(next, { type: ref.type, id: ref.id }, `p${page.id}-${stamp}-${i}`);
              });
              return next;
            }, true);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

const refKey = (r: { type: string; id: string }) => `${r.type}:${r.id}`;
/** Size (inches) the source renders a picker thumbnail / preview at. */
const THUMB_IN = { widthIn: 1.4, heightIn: 1.05 };
const PREVIEW_IN = { widthIn: 4.4, heightIn: 3.3 };

function AddFigurePicker({
  collectionId,
  onClose,
  onPickMany,
}: {
  collectionId: string | null;
  onClose: () => void;
  onPickMany: (refs: FigureRef[]) => void;
}) {
  const [allRefs, setAllRefs] = useState<FigureRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [preview, setPreview] = useState<string | null>(null);
  const inflight = useRef<Set<string>>(new Set());

  // Load every source once, baking the source label as each ref's group fallback
  // so a ref with no group still lands in a sensible "Group by table" bucket.
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: FigureRef[] = [];
      for (const src of listFigureSources()) {
        const refs = await src.list({ collectionId });
        for (const r of refs) out.push({ ...r, group: r.group ?? src.label });
      }
      if (live) {
        setAllRefs(out);
        setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [collectionId]);

  const view = useMemo(
    () => buildPickerView(allRefs, { kindFilter, groupBy, query, sourceLabel: "" }),
    [allRefs, kindFilter, groupBy, query],
  );

  const visibleRefs = useMemo(() => view.groups.flatMap((g) => g.refs), [view]);
  const visibleKeys = visibleRefs.map(refKey).join("|");

  // Keep a valid active selection as the filter/search changes.
  useEffect(() => {
    if (visibleRefs.length === 0) {
      setActive(null);
      return;
    }
    setActive((cur) => (cur && visibleRefs.some((r) => refKey(r) === cur) ? cur : refKey(visibleRefs[0])));
  }, [visibleKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lazily render thumbnails for the visible rows (cached, never re-fetched).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const r of visibleRefs) {
        const key = refKey(r);
        if (thumbs.has(key) || inflight.current.has(key)) continue;
        const src = getFigureSource(r.type);
        if (!src) continue;
        inflight.current.add(key);
        try {
          const out = await src.render(r.id, {
            ...THUMB_IN,
            dpi: SCREEN_DPI,
            theme: "light",
            overrides: { hideTitle: true },
          });
          if (!cancelled) setThumbs((prev) => new Map(prev).set(key, out.svg));
        } catch {
          // leave it blank; the row shows a neutral placeholder
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render the larger preview for the active figure.
  useEffect(() => {
    if (!active) {
      setPreview(null);
      return;
    }
    const r = allRefs.find((x) => refKey(x) === active);
    if (!r) return;
    const src = getFigureSource(r.type);
    if (!src) return;
    let cancelled = false;
    setPreview(null);
    void src
      .render(r.id, { ...PREVIEW_IN, dpi: SCREEN_DPI, theme: "light" })
      .then((out) => {
        if (!cancelled) setPreview(out.svg);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, allRefs]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const activeRef = active ? allRefs.find((r) => refKey(r) === active) ?? null : null;
  const confirm = () => onPickMany(allRefs.filter((r) => selected.has(refKey(r))));

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add figures"
        className="flex h-[560px] max-h-[85vh] w-[760px] max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-body font-bold">Add figures</h2>
          <div className="flex items-center gap-3">
            <span className="text-meta text-foreground-muted">{selected.size} selected</span>
            <button type="button" onClick={onClose} aria-label="Close">
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
          <div className="flex min-h-0 flex-col border-r border-border">
            <div className="space-y-2.5 p-3">
              <div className="relative">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-faint"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search figures"
                  aria-label="Search figures"
                  className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-2 text-meta"
                />
              </div>
              <div className="flex items-start gap-2">
                <Icon name="filter" className="mt-1 h-3.5 w-3.5 shrink-0 text-foreground-faint" />
                <div className="flex flex-wrap gap-1.5">
                  <FilterChip label="All" on={kindFilter === null} onClick={() => setKindFilter(null)} />
                  {view.kinds.map((k) => (
                    <FilterChip
                      key={k}
                      label={k}
                      on={kindFilter === k}
                      onClick={() => setKindFilter(kindFilter === k ? null : k)}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-meta text-foreground-faint">Group by</span>
                <div className="inline-flex overflow-hidden rounded-md border border-border-strong">
                  {(["table", "type", "none"] as GroupBy[]).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGroupBy(g)}
                      className={`px-2.5 py-1 text-meta capitalize ${groupBy === g ? "bg-brand-action text-white" : "text-foreground-muted"}`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {loading && <p className="px-2 py-3 text-meta text-foreground-muted">Loading figures...</p>}
              {!loading && allRefs.length === 0 && (
                <p className="px-2 py-3 text-meta text-foreground-muted">
                  No saved figures yet. Make a graph in the Data Hub first.
                </p>
              )}
              {!loading && allRefs.length > 0 && view.count === 0 && (
                <p className="px-2 py-3 text-meta text-foreground-muted">No figures match.</p>
              )}
              {view.groups.map((g) => (
                <div key={g.label || "_all"} className="mb-2">
                  {g.label && (
                    <p className="px-2 pb-1 pt-2 text-meta font-semibold uppercase tracking-wide text-foreground-faint">
                      {g.label}
                    </p>
                  )}
                  {g.refs.map((r) => {
                    const key = refKey(r);
                    const isSel = selected.has(key);
                    return (
                      <div
                        key={key}
                        onClick={() => setActive(key)}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-1.5 ${active === key ? "border-border-strong bg-surface" : "border-transparent hover:bg-surface"}`}
                        data-testid="picker-row"
                      >
                        <div
                          className="h-[30px] w-[42px] shrink-0 overflow-hidden rounded border border-border bg-white [&>svg]:h-full [&>svg]:w-full"
                          dangerouslySetInnerHTML={{ __html: thumbs.get(key) ?? "" }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-meta text-foreground">{r.name}</div>
                          {groupBy !== "table" && r.group && (
                            <div className="truncate text-[11px] text-foreground-faint">{r.group}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label={isSel ? "Deselect" : "Select"}
                          aria-pressed={isSel}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(key);
                          }}
                          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border ${isSel ? "border-brand-action bg-brand-action text-white" : "border-border-strong"}`}
                        >
                          {isSel && <Icon name="check" className="h-3 w-3" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col bg-surface-sunken">
            <div className="flex min-h-0 flex-1 items-center justify-center p-5">
              {activeRef ? (
                preview ? (
                  <div
                    className="max-h-full max-w-full [&>svg]:max-h-full [&>svg]:max-w-full"
                    dangerouslySetInnerHTML={{ __html: preview }}
                  />
                ) : (
                  <p className="text-meta text-foreground-faint">Rendering preview...</p>
                )
              ) : (
                <p className="text-meta text-foreground-faint">Select a figure to preview it.</p>
              )}
            </div>
            {activeRef && (
              <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
                {activeRef.kind && (
                  <span className="rounded-md bg-brand-action/10 px-2 py-0.5 text-[11px] text-brand-action">
                    {activeRef.kind}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-meta font-semibold text-foreground">{activeRef.name}</div>
                  {activeRef.group && (
                    <div className="truncate text-[11px] text-foreground-faint">{activeRef.group}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toggle(active!)}
                  className={`rounded-lg border px-2.5 py-1 text-meta font-medium ${selected.has(active!) ? "border-brand-action text-brand-action" : "border-border-strong hover:border-brand-action"}`}
                >
                  {selected.has(active!) ? "Selected" : "Select"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
            className="text-meta font-medium text-foreground-muted hover:underline disabled:opacity-40"
          >
            Clear selection
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-brand-action"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={selected.size === 0}
              className="ros-btn-raise rounded-lg bg-brand-action px-3 py-1.5 text-meta font-semibold text-white disabled:opacity-40"
              data-testid="picker-add"
            >
              Add {selected.size} figure{selected.size === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] ${on ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border text-foreground-muted hover:border-border-strong"}`}
    >
      {label}
    </button>
  );
}

/** The screen-space bounding box (px) of an annotation, for hit + highlight. */
function annBox(a: Annotation, scale: number): { x: number; y: number; w: number; h: number } {
  if (a.kind === "text") {
    const fs = (a.fontPt * scale) / 72;
    return { x: a.xIn * scale, y: a.yIn * scale - fs, w: Math.max(30, a.text.length * fs * 0.6), h: fs * 1.3 };
  }
  if (a.kind === "arrow") {
    return {
      x: Math.min(a.x1In, a.x2In) * scale,
      y: Math.min(a.y1In, a.y2In) * scale,
      w: Math.abs(a.x2In - a.x1In) * scale,
      h: Math.abs(a.y2In - a.y1In) * scale,
    };
  }
  const tick = Math.max(4, 0.06 * scale);
  return a.orientation === "horizontal"
    ? { x: a.xIn * scale, y: a.yIn * scale - tick, w: a.spanIn * scale, h: tick * 2.5 }
    : { x: a.xIn * scale - tick, y: a.yIn * scale, w: tick * 2.5, h: a.spanIn * scale };
}
