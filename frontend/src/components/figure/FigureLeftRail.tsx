"use client";

// The signature left insert/file rail for the Figure composer (the three-zone
// BioRender layout). A 52px icon nav strip + a contextual panel: Figures (your
// pages), Icons (the open-asset library, inline), Text, Shapes, Connect,
// Templates, Layers. Insert lives on the LEFT; the contextual inspector stays on
// the right. House style: <Icon> only, no inline svg, no em-dashes, no
// mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import {
  loadAssetManifest,
  searchAssets,
  listCategories,
  assetSvgUrl,
  type LibraryAsset,
} from "@/lib/figure/asset-library";
import type { FigurePage, TextVariant } from "@/lib/figure/figure-page";

export type RailSection =
  | "figures"
  | "icons"
  | "text"
  | "shapes"
  | "connect"
  | "templates"
  | "layers";

const NAV: { key: RailSection; label: string; icon: IconName }[] = [
  { key: "figures", label: "Figures", icon: "figure" },
  { key: "icons", label: "Icons", icon: "library" },
  { key: "text", label: "Text", icon: "text" },
  { key: "shapes", label: "Shapes", icon: "pencil" },
  { key: "connect", label: "Connect", icon: "lineage" },
  { key: "templates", label: "Templates", icon: "table" },
  { key: "layers", label: "Layers", icon: "layer" },
];

export default function FigureLeftRail({
  tool,
  setTool,
  textVariant,
  setTextVariant,
  onPickIcon,
  pages,
  currentPageId,
  onOpenPage,
  onNewPage,
  onAddFigure,
}: {
  tool: null | "text" | "arrow" | "bracket" | "connect";
  setTool: (t: null | "text" | "arrow" | "bracket" | "connect") => void;
  textVariant: TextVariant;
  setTextVariant: (v: TextVariant) => void;
  onPickIcon: (asset: LibraryAsset) => void;
  pages: FigurePage[];
  currentPageId: string;
  onOpenPage: (id: string) => void;
  onNewPage: () => void;
  onAddFigure: () => void;
}) {
  // Default to Icons (the library is the headline of this rail).
  const [section, setSection] = useState<RailSection>("icons");

  return (
    <div className="flex shrink-0 overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex w-[52px] flex-col items-center gap-1 border-r border-border bg-surface-sunken py-2">
        {NAV.map((n) => (
          <button
            key={n.key}
            type="button"
            title={n.label}
            onClick={() => setSection(n.key)}
            className={`flex h-11 w-[42px] flex-col items-center justify-center gap-0.5 rounded-lg border text-[9px] ${
              section === n.key
                ? "border-border-strong bg-surface font-semibold text-brand-action"
                : "border-transparent text-foreground-muted hover:bg-surface"
            }`}
          >
            <Icon name={n.icon} className="h-[18px] w-[18px]" />
            {n.label}
          </button>
        ))}
      </div>

      <div className="flex w-60 min-w-0 flex-col p-3">
        {section === "icons" && <IconsPanel onPick={onPickIcon} />}
        {section === "figures" && (
          <FiguresPanel
            pages={pages}
            currentPageId={currentPageId}
            onOpenPage={onOpenPage}
            onNewPage={onNewPage}
            onAddFigure={onAddFigure}
          />
        )}
        {section === "text" && (
          <ToolPanel
            title="Text"
            active={tool === "text"}
            activate={() => setTool(tool === "text" ? null : "text")}
            activateLabel="Place text"
            hint="Click the page to place the selected text style."
          >
            <div className="mt-2 flex gap-1">
              {(["heading", "label", "body"] as TextVariant[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setTextVariant(v);
                    setTool("text");
                  }}
                  className={`flex-1 rounded border px-1.5 py-1 text-meta capitalize ${textVariant === v ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong hover:border-brand-action"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </ToolPanel>
        )}
        {section === "connect" && (
          <ToolPanel
            title="Connect"
            active={tool === "connect"}
            activate={() => setTool(tool === "connect" ? null : "connect")}
            activateLabel="Smart connector"
            hint="Drag from a blue node on one element onto another to connect them."
          />
        )}
        {section === "shapes" && (
          <ComingSoon title="Shapes" note="Rectangles, ellipses, lines and arrows land here next." />
        )}
        {section === "templates" && (
          <ComingSoon
            title="Templates"
            note="Start from a gallery layout that can bind to your data. Coming next."
          />
        )}
        {section === "layers" && (
          <ComingSoon title="Layers" note="Reorder, lock, and rename every element on the page." />
        )}
      </div>
    </div>
  );
}

function PanelHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center justify-between text-meta font-bold uppercase tracking-wide text-foreground-faint">
      {children}
    </h3>
  );
}

function IconsPanel({ onPick }: { onPick: (a: LibraryAsset) => void }) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadAssetManifest().then((a) => {
      if (!live) return;
      setAssets(a);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const categories = useMemo(() => listCategories(assets), [assets]);
  const results = useMemo(
    () => searchAssets(assets, { query, category }).slice(0, 240),
    [assets, query, category],
  );

  return (
    <>
      <PanelHead>Icons</PanelHead>
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-border-strong bg-surface-sunken px-2 py-1.5">
        <Icon name="search" className="h-3.5 w-3.5 text-foreground-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons..."
          className="w-full bg-transparent text-meta outline-none placeholder:text-foreground-faint"
        />
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setCategory(null)}
          className={`rounded-full px-2 py-0.5 text-[10.5px] ${category === null ? "bg-brand-action text-white" : "border border-border-strong text-foreground-muted"}`}
        >
          All
        </button>
        {categories.slice(0, 10).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full px-2 py-0.5 text-[10.5px] ${category === c ? "bg-brand-action text-white" : "border border-border-strong text-foreground-muted"}`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="p-4 text-center text-meta text-foreground-muted">Loading the library...</p>
        ) : assets.length === 0 ? (
          <p className="p-4 text-center text-meta text-foreground-faint">
            No assets available yet.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {results.map((a) => (
              <button
                key={a.uid}
                type="button"
                onClick={() => onPick(a)}
                title={`${a.title} (${a.license}${a.requiresAttribution ? ", cited" : ""})`}
                className="flex aspect-square items-center justify-center rounded-lg border border-border bg-surface-sunken p-1.5 hover:border-brand-action"
                data-testid="figure-icon-option"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetSvgUrl(a)} alt={a.title} loading="lazy" className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-2 text-[10px] text-foreground-faint">
        {loading ? "" : `${results.length} of ${assets.length}. Credits auto-added.`}
      </p>
    </>
  );
}

function FiguresPanel({
  pages,
  currentPageId,
  onOpenPage,
  onNewPage,
  onAddFigure,
}: {
  pages: FigurePage[];
  currentPageId: string;
  onOpenPage: (id: string) => void;
  onNewPage: () => void;
  onAddFigure: () => void;
}) {
  return (
    <>
      <PanelHead>
        Figures
        <button
          type="button"
          onClick={onNewPage}
          title="New figure page"
          className="text-foreground-muted hover:text-brand-action"
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
        </button>
      </PanelHead>
      <button
        type="button"
        onClick={onAddFigure}
        className="mb-2 flex items-center justify-center gap-1.5 rounded-lg border border-border-strong px-2 py-1.5 text-meta font-semibold hover:border-brand-action"
      >
        <Icon name="plus" className="h-3.5 w-3.5" /> Add a figure to this page
      </button>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto">
        {pages.length === 0 && (
          <p className="p-2 text-meta text-foreground-faint">No figure pages yet.</p>
        )}
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpenPage(p.id)}
            className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-meta ${
              p.id === currentPageId
                ? "border-brand-action bg-brand-action/10 text-brand-action"
                : "border-border hover:border-brand-action"
            }`}
          >
            <Icon name="figure" className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="shrink-0 text-[10px] text-foreground-faint">{p.panels.length}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ToolPanel({
  title,
  active,
  activate,
  activateLabel,
  hint,
  children,
}: {
  title: string;
  active: boolean;
  activate: () => void;
  activateLabel: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <PanelHead>{title}</PanelHead>
      <button
        type="button"
        onClick={activate}
        className={`w-full rounded-lg border px-2 py-1.5 text-meta font-medium ${active ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong hover:border-brand-action"}`}
      >
        {active ? `${activateLabel} (active)` : activateLabel}
      </button>
      {children}
      {active && <p className="mt-2 text-meta text-foreground-faint">{hint}</p>}
    </>
  );
}

function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <>
      <PanelHead>{title}</PanelHead>
      <p className="text-meta text-foreground-faint">{note}</p>
    </>
  );
}
