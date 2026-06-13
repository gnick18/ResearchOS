"use client";

// The Tree Studio (phylo Phase 2 + 3 + 4), the iTOL alternative.
//
// You bring a finished tree (upload / paste / a saved tree), link a metadata
// table, toggle annotation tracks, edit the figure (reroot, ladderize, collapse,
// layout, phylogram vs cladogram, support values), and export SVG / PNG / copy
// plus the reproducible ggtree code. Native SVG, no server, no tree inference.
//
// All raw SVG markup is produced by lib/phylo/render.ts (the single renderer
// module). This component never writes SVG itself, it injects the renderer
// string and renders <Icon> UI chrome. The export path reuses the Data Hub
// helpers (downloadSvg / svgToPngBlob / clipboard) so what you see is what you
// export. Matches the approved mockup (docs/mockups/2026-06-12-phylogenetics-page.html).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { phyloApi } from "@/lib/phylo/api";
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";
import type { PhyloMeta } from "@/lib/phylo/types";
import {
  parseTree,
  leaves,
  TreeParseError,
  type TreeNode,
} from "@/lib/phylo/parse";
import {
  ladderize,
  midpointRoot,
  rerootOnNode,
  parseCsv,
  matchMetadataToTips,
  bestTipColumn,
  type MetadataMatch,
} from "@/lib/phylo/layout";
import {
  renderTreeSvg,
  type RenderSpec,
  type FigureTracks,
} from "@/lib/phylo/render";
import {
  figureToRenderSpec,
  figureInputsFromStored,
  DEFAULT_FIGURE_TRACKS,
} from "@/lib/phylo/figure-to-render";
import {
  objectDeepLink,
  objectEmbedMarkdown,
  DEFAULT_EMBED_VIEW,
} from "@/lib/references";
import { generateGgtreeCode, GGTREE_CAVEAT } from "@/lib/phylo/ggtree-code";
import {
  downloadSvg,
  svgToPngBlob,
} from "@/lib/datahub/plot-spec";

const FIG_W = 620;
const FIG_H = 460;

const SAMPLE_TREE =
  "(((A. fumigatus:0.5,A. fischeri:0.5)100:0.3,(((A. flavus:0.45,A. oryzae:0.45)96:0.25,(A. nidulans:0.55,(A. niger:0.4,P. chrysogenum:0.6)90:0.2)85:0.18)80:0.15));";

const SAMPLE_CSV = [
  "tip,section,genome,gliP",
  "A. fumigatus,Fumigati,29.4,yes",
  "A. fischeri,Fumigati,32.5,no",
  "A. flavus,Flavi,37.0,yes",
  "A. oryzae,Flavi,37.1,no",
  "A. nidulans,Nidulantes,30.1,no",
  "A. niger,Nigri,34.0,yes",
  "P. chrysogenum,Outgroup,32.2,no",
].join("\n");

type ImportMode = "upload" | "paste" | "saved" | null;

// The track defaults live in the shared adapter so the Studio and the embed start
// from the same baseline; aliased here for the local reset paths.
const DEFAULT_TRACKS: FigureTracks = DEFAULT_FIGURE_TRACKS;

export function PhyloStudio({ initialTreeId }: { initialTreeId?: string } = {}) {
  // The working tree (immutable, edits replace it). Null until a tree is brought in.
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [treeName, setTreeName] = useState("Untitled tree");
  // The id of the saved tree currently open, when one was opened from the library
  // (saved picker, demo auto-open, or a ?doc= deep link). Drives Copy reference,
  // which can only point at a tree that already lives in the store. Null for a
  // freshly imported / pasted tree that has not been saved yet.
  const [openTreeId, setOpenTreeId] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>(null);
  const [pasteText, setPasteText] = useState("");

  const [layout, setLayout] = useState<"rectangular" | "circular">(
    "rectangular",
  );
  const [phylogram, setPhylogram] = useState(true);
  const [tracks, setTracks] = useState<FigureTracks>(DEFAULT_TRACKS);

  // Metadata binding.
  const [metaRows, setMetaRows] = useState<Record<string, string>[] | null>(
    null,
  );
  const [metaColumns, setMetaColumns] = useState<string[]>([]);
  const [tipColumn, setTipColumn] = useState<string>("");
  const [categoryColumn, setCategoryColumn] = useState<string>("");
  const [barColumn, setBarColumn] = useState<string>("");
  const [heatColumns, setHeatColumns] = useState<string[]>([]);

  const [showCode, setShowCode] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "image" | "text">("idle");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState<PhyloMeta[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

  // Load saved trees for the "From a saved tree" picker. In a demo session, open
  // the showcase tree straight away so the Studio lands on a populated, real
  // figure instead of the empty import panel (the screenshots + public demo).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    phyloApi
      .list()
      .then((list) => {
        setSaved(list);
        if (getDemoMode() && !autoOpenedRef.current && list.length > 0) {
          autoOpenedRef.current = true;
          // Lowest id is the Candida auris circular showcase tree.
          const showcase = [...list].sort((a, b) => Number(a.id) - Number(b.id))[0];
          void onPickSaved(showcase.id);
        }
      })
      .catch(() => setSaved([]));
    // onPickSaved is stable for this mount; demo auto-open runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A `?doc=<id>` deep link (the form a phylo object reference / embed builds via
  // objectDeepLink("phylo", ...)) opens that tree in the Studio on first load.
  // Read after mount and once only, mirroring the Data Hub page, so the static
  // export never trips on useSearchParams and a later manual pick is not yanked
  // back. The id wins over the demo auto-open above (a deliberate link beats the
  // showcase default).
  const deepLinkOpenedRef = useRef(false);
  useEffect(() => {
    if (deepLinkOpenedRef.current) return;
    if (!initialTreeId) {
      deepLinkOpenedRef.current = true;
      return;
    }
    deepLinkOpenedRef.current = true;
    autoOpenedRef.current = true; // suppress the demo auto-open, the link wins
    void onPickSaved(initialTreeId);
    // onPickSaved is stable for this mount; the deep link is consumed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTreeId]);

  // The metadata match (tip ids -> rows), recomputed when the binding changes.
  const match: MetadataMatch | null = useMemo(() => {
    if (!tree || !metaRows || !tipColumn) return null;
    return matchMetadataToTips(tree, metaRows, tipColumn);
  }, [tree, metaRows, tipColumn]);

  // The single figure spec the renderer + the ggtree exporter both read, built by
  // the shared figure -> RenderSpec adapter so the Studio canvas, the export, and
  // an embedded card all map the same figure to the same spec (one mapping).
  const spec: RenderSpec | null = useMemo(() => {
    if (!tree) return null;
    return figureToRenderSpec(
      tree,
      {
        layout,
        phylogram,
        tracks,
        categoryColumn,
        barColumn,
        heatColumns,
        metaRows,
        tipColumn,
      },
      { width: FIG_W, height: FIG_H },
    );
  }, [
    tree,
    layout,
    phylogram,
    tracks,
    categoryColumn,
    barColumn,
    heatColumns,
    metaRows,
    tipColumn,
  ]);

  const svgMarkup = useMemo(
    () => (tree && spec ? renderTreeSvg(tree, spec) : ""),
    [tree, spec],
  );
  const ggtreeCode = useMemo(
    () => (spec ? generateGgtreeCode(spec) : ""),
    [spec],
  );

  // ---- tree import ----

  function loadTreeText(text: string, name: string) {
    try {
      const parsed = parseTree(text);
      setTree(parsed);
      setTreeName(name);
      setParseError(null);
      setImportMode(null);
      setPasteText("");
      // A freshly imported / pasted tree has no stored id yet; onPickSaved and
      // onSave set it back when the tree is opened from or written to the store.
      setOpenTreeId(null);
    } catch (err) {
      setParseError(
        err instanceof TreeParseError
          ? err.message
          : "Could not read that tree. Check it is valid Newick or Nexus.",
      );
    }
  }

  async function onUploadFile(file: File) {
    const text = await file.text();
    loadTreeText(text, file.name.replace(/\.[^.]+$/, ""));
  }

  async function onPickSaved(id: string) {
    const raw = await phyloApi.get(id);
    if (!raw) return;
    loadTreeText(raw.tree, raw.meta.name);
    restoreSavedFigure(raw.meta);
    // This tree lives in the store, so Copy reference can point at it.
    setOpenTreeId(id);
  }

  /**
   * Reopen a saved tree into the same figure it was exported with. The figure
   * spec (layout / phylogram / tracks) and the bound metadata (rows, tip column,
   * and the per-track column bindings) all live in the sidecar, so a saved tree
   * lands looking like its last save instead of a bare cladogram.
   */
  function restoreSavedFigure(meta: PhyloMeta) {
    // Resolve the stored figure + metadata through the shared adapter so the
    // Studio reopens a saved tree from the same mapping an embed renders it with.
    const inputs = figureInputsFromStored(meta.figure, meta.metadata);
    setLayout(inputs.layout);
    setPhylogram(inputs.phylogram);
    setTracks(inputs.tracks);
    if (inputs.metaRows) {
      setMetaRows(inputs.metaRows);
      const cols =
        inputs.metaRows.length > 0 ? Object.keys(inputs.metaRows[0]) : [];
      setMetaColumns(cols);
      setTipColumn(inputs.tipColumn ?? cols[0] ?? "");
      setCategoryColumn(inputs.categoryColumn ?? "");
      setBarColumn(inputs.barColumn ?? "");
      setHeatColumns(inputs.heatColumns ?? []);
    } else {
      setMetaRows(null);
      setMetaColumns([]);
      setTipColumn("");
      setCategoryColumn("");
      setBarColumn("");
      setHeatColumns([]);
    }
  }

  // ---- metadata import ----

  function loadCsvText(text: string) {
    const parsed = parseCsv(text);
    if (parsed.columns.length === 0) return;
    setMetaRows(parsed.rows);
    setMetaColumns(parsed.columns);
    // Auto-detect the join key: the column that matches the most tree tips, so
    // the user does not have to hunt for which column lines up with the tips.
    // Falls back to the first column when no tree is loaded yet.
    const tipCol = tree
      ? bestTipColumn(tree, parsed.rows, parsed.columns)
      : parsed.columns[0];
    setTipColumn(tipCol);
    setCategoryColumn(parsed.columns.find((c) => c !== tipCol) ?? "");
  }

  async function onUploadCsv(file: File) {
    loadCsvText(await file.text());
  }

  // ---- editing ----

  const reroot = (mode: "midpoint" | "outgroup", nodeId?: number) => {
    if (!tree) return;
    setTree(
      mode === "midpoint"
        ? midpointRoot(tree)
        : nodeId != null
          ? rerootOnNode(tree, nodeId)
          : tree,
    );
  };
  const doLadderize = () => tree && setTree(ladderize(tree, true));
  const toggleTrack = (k: keyof FigureTracks) =>
    setTracks((t) => ({ ...t, [k]: !t[k] }));

  // ---- export ----

  const onExportSvg = () => svgMarkup && downloadSvg(svgMarkup, treeName || "tree");
  const onExportPng = async () => {
    if (!svgMarkup) return;
    const blob = await svgToPngBlob(svgMarkup, FIG_W, FIG_H, 3);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${treeName || "tree"}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const onCopy = async () => {
    if (!svgMarkup) return;
    try {
      const canImage =
        typeof ClipboardItem !== "undefined" &&
        !!navigator.clipboard?.write;
      if (canImage) {
        const blob = await svgToPngBlob(svgMarkup, FIG_W, FIG_H, 3);
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        setCopyState("image");
      } else {
        await navigator.clipboard.writeText(svgMarkup);
        setCopyState("text");
      }
      setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("idle");
    }
  };

  // ---- persist ----

  const onSave = async () => {
    if (!tree) return;
    const figure = {
      layout,
      branchLengths: phylogram,
      tracks: tracks as unknown as Record<string, boolean>,
    };
    const metadata =
      metaRows && tipColumn
        ? {
            tipColumn,
            rows: metaRows,
            categoryColumn: categoryColumn || undefined,
            barColumn: barColumn || undefined,
            heatColumns: heatColumns.length > 0 ? heatColumns : undefined,
          }
        : undefined;
    const created = await phyloApi.create(serializeNewick(tree), {
      name: treeName || "Untitled tree",
      project_ids: [],
      format: "newick",
      source: "upload",
      figure,
      metadata,
    });
    // The tree now lives in the store, so Copy reference can point at it.
    setOpenTreeId(created.meta.id);
    setSavedMsg("Saved to your trees");
    setTimeout(() => setSavedMsg(null), 2200);
    phyloApi.list().then(setSaved);
  };

  // Copy a note / chat reference to this saved tree. The clipboard gets the embed
  // markdown (a `#ros=` figure view, so a note renders the live tree card) on the
  // first line and the bare deep link on the second, so a paste target that strips
  // markdown still keeps a working link. Only offered once the tree is in the store
  // (openTreeId set), the same rule molecules and Data Hub docs follow.
  const onCopyReference = async () => {
    if (!openTreeId) return;
    const name = treeName || "Untitled tree";
    const embed = objectEmbedMarkdown("phylo", openTreeId, name, {
      view: DEFAULT_EMBED_VIEW.phylo,
    });
    const link = objectDeepLink("phylo", openTreeId);
    try {
      await navigator.clipboard?.writeText(`${embed}\n${link}`);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 1800);
    } catch {
      setCopiedRef(false);
    }
  };

  // ---- render ----

  if (!tree) {
    return (
      <ImportPanel
        importMode={importMode}
        setImportMode={setImportMode}
        pasteText={pasteText}
        setPasteText={setPasteText}
        parseError={parseError}
        saved={saved}
        fileRef={fileRef}
        onUploadFile={onUploadFile}
        onPickSaved={onPickSaved}
        onLoadPaste={() => loadTreeText(pasteText, "Pasted tree")}
        onSample={() => loadTreeText(SAMPLE_TREE, "Aspergillus sample")}
      />
    );
  }

  const tips = leaves(tree);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_250px] gap-3.5 items-start">
      {/* Left rail: tree + metadata */}
      <div className="space-y-3.5">
        <Panel title="Tree">
          <div className="text-sm text-foreground-muted mb-2 truncate">
            {treeName} ({tips.length} tips)
          </div>
          <div className="flex flex-wrap gap-1.5">
            <GhostBtn onClick={() => setTree(null)}>Change tree</GhostBtn>
            <GhostBtn onClick={doLadderize}>Ladderize</GhostBtn>
            <GhostBtn onClick={() => reroot("midpoint")}>Midpoint root</GhostBtn>
          </div>
          <RerootPicker tips={tips} onReroot={(id) => reroot("outgroup", id)} />
        </Panel>

        <Panel title="Metadata">
          <p className="text-xs text-foreground-muted mb-2">
            Columns map onto annotation tracks. Unmatched tips are shown, never
            dropped.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <GhostBtn onClick={() => csvFileRef.current?.click()}>
              Drop CSV
            </GhostBtn>
            <GhostBtn onClick={() => loadCsvText(SAMPLE_CSV)}>
              Sample table
            </GhostBtn>
          </div>
          <input
            ref={csvFileRef}
            type="file"
            accept=".csv,.tsv,text/csv"
            className="hidden"
            onChange={(e) =>
              e.target.files?.[0] && onUploadCsv(e.target.files[0])
            }
          />
          {metaColumns.length > 0 && (
            <div className="mt-3 space-y-2">
              <ColumnSelect
                label="Tip id column"
                value={tipColumn}
                options={metaColumns}
                onChange={setTipColumn}
              />
              <ColumnSelect
                label="Category (points / strip)"
                value={categoryColumn}
                options={["", ...metaColumns]}
                onChange={setCategoryColumn}
              />
              <ColumnSelect
                label="Bar chart value"
                value={barColumn}
                options={["", ...metaColumns]}
                onChange={setBarColumn}
              />
            </div>
          )}
          {match && (
            <div
              className={`mt-2 text-xs font-medium ${
                match.unmatchedTips.length === 0
                  ? "text-emerald-600"
                  : "text-foreground-muted"
              }`}
            >
              Matched {match.matched.size} of{" "}
              {match.matched.size + match.unmatchedTips.length} tips on{" "}
              {tipColumn}
            </div>
          )}
          {match && match.unmatchedTips.length > 0 && (
            <div className="mt-2 text-xs text-amber-600">
              {match.unmatchedTips.length} tip
              {match.unmatchedTips.length === 1 ? "" : "s"} with no metadata:{" "}
              {match.unmatchedTips.slice(0, 3).join(", ")}
              {match.unmatchedTips.length > 3 ? "..." : ""}
            </div>
          )}
          {match && match.unmatchedRows.length > 0 && (
            <div className="mt-1 text-xs text-amber-600">
              {match.unmatchedRows.length} metadata row
              {match.unmatchedRows.length === 1 ? "" : "s"} matched no tip.
            </div>
          )}
        </Panel>
      </div>

      {/* Center: the live canvas */}
      <div className="border border-border rounded-2xl bg-surface-raised p-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Seg
            value={layout}
            options={[
              ["rectangular", "Rectangular"],
              ["circular", "Circular"],
            ]}
            onChange={setLayout}
          />
          <span className="grow" />
          <Seg
            value={phylogram ? "phylo" : "clado"}
            options={[
              ["phylo", "Phylogram"],
              ["clado", "Cladogram"],
            ]}
            onChange={(v) => setPhylogram(v === "phylo")}
          />
        </div>
        {/* The renderer string is the single source of SVG; injected here. */}
        <div
          className="w-full"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
      </div>

      {/* Right rail: tracks + export */}
      <div className="space-y-3.5">
        <Panel title="Annotation tracks">
          <TrackRow label="Tip labels" on={tracks.labels} onClick={() => toggleTrack("labels")} />
          <TrackRow
            label="Italic labels"
            on={tracks.labelsItalic}
            onClick={() => toggleTrack("labelsItalic")}
          />
          <TrackRow label="Tip points" on={tracks.points} onClick={() => toggleTrack("points")} />
          <TrackRow label="Color strip" on={tracks.strip} onClick={() => toggleTrack("strip")} />
          <TrackRow label="Bar chart" on={tracks.bars} onClick={() => toggleTrack("bars")} />
          <TrackRow label="Clade highlight" on={tracks.clade} onClick={() => toggleTrack("clade")} />
          <TrackRow
            label="Support values"
            on={tracks.support}
            onClick={() => toggleTrack("support")}
          />
        </Panel>

        <Panel title="Export">
          <div className="flex flex-wrap gap-1.5">
            <Tooltip label="Vector SVG, infinitely scalable">
              <button onClick={onExportSvg} className={GHOST_CLASS}>
                SVG
              </button>
            </Tooltip>
            <Tooltip label="Hi-DPI PNG for slides and print">
              <button onClick={onExportPng} className={GHOST_CLASS}>
                PNG
              </button>
            </Tooltip>
            <Tooltip label="Copy the figure to paste straight into a doc">
              <button onClick={onCopy} className={GHOST_CLASS}>
                {copyState === "image"
                  ? "Copied"
                  : copyState === "text"
                    ? "Copied SVG"
                    : "Copy"}
              </button>
            </Tooltip>
          </div>
          <button
            onClick={() => setShowCode((s) => !s)}
            className="mt-2 w-full px-3 py-1.5 rounded-lg font-bold text-sm bg-accent-soft text-accent hover:opacity-90"
          >
            {showCode ? "Hide ggtree code" : "ggtree code"}
          </button>
          <button
            onClick={onSave}
            className="mt-2 w-full px-3 py-1.5 rounded-lg font-bold text-sm border border-border text-foreground hover:border-accent flex items-center justify-center gap-1.5"
          >
            <Icon name="save" className="w-4 h-4" />
            Save to my trees
          </button>
          {openTreeId && (
            <Tooltip label="Copy a link that renders this tree as a figure in a note">
              <button
                onClick={onCopyReference}
                className="mt-2 w-full px-3 py-1.5 rounded-lg font-bold text-sm border border-border text-foreground hover:border-accent flex items-center justify-center gap-1.5"
              >
                <Icon name="reference" className="w-4 h-4" />
                {copiedRef ? "Reference copied" : "Copy reference for a note"}
              </button>
            </Tooltip>
          )}
          {savedMsg && (
            <div className="mt-1 text-xs text-brand-sky font-semibold">
              {savedMsg}
            </div>
          )}
        </Panel>
      </div>

      {/* The ggtree code panel spans the full width below the studio. */}
      {showCode && (
        <div className="lg:col-span-3 border border-border rounded-2xl bg-surface-raised p-4">
          <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
            <Icon name="alert" className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              <span className="font-bold">Heads up. </span>
              {GGTREE_CAVEAT}
            </p>
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap text-foreground bg-surface rounded-lg p-3 overflow-x-auto">
            {ggtreeCode}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import (no tree loaded yet).
// ---------------------------------------------------------------------------

function ImportPanel(props: {
  importMode: ImportMode;
  setImportMode: (m: ImportMode) => void;
  pasteText: string;
  setPasteText: (s: string) => void;
  parseError: string | null;
  saved: PhyloMeta[];
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUploadFile: (f: File) => void;
  onPickSaved: (id: string) => void;
  onLoadPaste: () => void;
  onSample: () => void;
}) {
  const {
    importMode,
    setImportMode,
    pasteText,
    setPasteText,
    parseError,
    saved,
    fileRef,
    onUploadFile,
    onPickSaved,
    onLoadPaste,
    onSample,
  } = props;
  return (
    <div className="max-w-2xl mx-auto">
      <div className="border border-border rounded-2xl bg-surface-raised p-6">
        <div className="flex items-center gap-3 mb-1">
          <Icon name="tree" className="w-7 h-7 text-brand-sky" />
          <h2 className="text-title font-extrabold text-foreground">
            Bring a finished tree
          </h2>
        </div>
        <p className="text-sm text-foreground-muted mb-4">
          The Studio renders and annotates the tree your script produced. It
          never infers a tree, so nothing runs on a server. Upload a Newick or
          Nexus file, paste the text, or open a tree you already saved.
        </p>
        <div className="flex flex-wrap gap-2">
          <GhostBtn onClick={() => fileRef.current?.click()}>
            <Icon name="import" className="w-4 h-4" /> Upload
          </GhostBtn>
          <GhostBtn
            onClick={() =>
              setImportMode(importMode === "paste" ? null : "paste")
            }
          >
            <Icon name="paste" className="w-4 h-4" /> Paste
          </GhostBtn>
          <GhostBtn
            onClick={() =>
              setImportMode(importMode === "saved" ? null : "saved")
            }
          >
            <Icon name="library" className="w-4 h-4" /> From a saved tree
          </GhostBtn>
          <GhostBtn onClick={onSample}>Try a sample</GhostBtn>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".nwk,.tree,.treefile,.nex,.nexus,.txt,text/plain"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onUploadFile(e.target.files[0])}
        />

        {importMode === "paste" && (
          <div className="mt-4">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="(A:0.1,B:0.2);"
              className="w-full h-28 text-sm font-mono border border-border rounded-lg p-2 bg-surface text-foreground"
            />
            <GhostBtn onClick={onLoadPaste}>Load this tree</GhostBtn>
          </div>
        )}

        {importMode === "saved" && (
          <div className="mt-4">
            {saved.length === 0 ? (
              <p className="text-sm text-foreground-muted">
                No saved trees yet. Upload or paste one to get started.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {saved.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onPickSaved(t.id)}
                    className="text-left border border-border rounded-lg p-2.5 hover:border-accent"
                  >
                    <div className="font-semibold text-sm text-foreground truncate">
                      {t.name}
                    </div>
                    <div className="text-xs text-foreground-muted">
                      {t.tip_count ?? "?"} tips
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {parseError && (
          <div className="mt-3 text-sm text-red-600">{parseError}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small UI atoms (match the Builder / Hub style).
// ---------------------------------------------------------------------------

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-2xl bg-surface-raised p-3.5">
      <h3 className="text-sm font-bold text-foreground mb-2">{title}</h3>
      {children}
    </div>
  );
}

const GHOST_CLASS =
  "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-accent hover:text-accent transition-colors";

function GhostBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className={GHOST_CLASS}>
      {children}
    </button>
  );
}

function TrackRow({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between py-1.5 text-sm text-foreground"
    >
      <span>{label}</span>
      <span
        className={`w-9 h-5 rounded-full relative transition-colors ${
          on ? "bg-brand-sky" : "bg-border"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
            on ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 p-0.5 border border-border rounded-lg bg-surface">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
            value === v
              ? "bg-accent-soft text-accent"
              : "text-foreground-muted hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-foreground-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full text-sm border border-border rounded-lg px-2 py-1 bg-surface text-foreground"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === "" ? "(none)" : o}
          </option>
        ))}
      </select>
    </label>
  );
}

function RerootPicker({
  tips,
  onReroot,
}: {
  tips: TreeNode[];
  onReroot: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-semibold text-accent hover:underline"
      >
        {open ? "Hide outgroup rooting" : "Reroot on an outgroup"}
      </button>
      {open && (
        <div className="mt-1 max-h-40 overflow-y-auto border border-border rounded-lg">
          {tips.map((t) => (
            <button
              key={t.id}
              onClick={() => onReroot(t.id)}
              className="w-full text-left text-xs px-2 py-1 hover:bg-accent-soft text-foreground truncate"
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

// blankTree + firstCladeHighlight moved into the shared figure -> RenderSpec
// adapter (lib/phylo/figure-to-render.ts) so the Studio and the embed map a
// figure to the same spec from one place.

/** Serialize a tree back to Newick for persistence (round-trips the edits). */
function serializeNewick(node: TreeNode): string {
  const write = (n: TreeNode): string => {
    let s = "";
    if (n.children.length > 0) {
      s += "(" + n.children.map(write).join(",") + ")";
      if (n.support !== null) s += String(n.support);
    } else {
      s += /[\s,():;]/.test(n.name) ? `'${n.name.replace(/'/g, "''")}'` : n.name;
    }
    if (n.branchLength !== null) s += ":" + n.branchLength;
    return s;
  };
  return write(node) + ";";
}
