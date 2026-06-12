"use client";

// The Tree Builder (phylo Phase 1). A choose-your-options wizard that generates
// the exact tree-building commands. NOTHING runs on a server, the recipe is text
// the researcher runs on their own machine. The recipe generator (lib/phylo/
// recipe.ts) is pure and shared with the eventual BeakerBot plain-language path.
// Matches the approved mockup (docs/mockups/2026-06-12-phylogenetics-page.html).

import { useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  DEFAULT_OPTIONS,
  DATA_TYPES,
  HAVE_INPUTS,
  ALIGN_TOOLS,
  TRIM_TOOLS,
  MODEL_CHOICES,
  INFER_TOOLS,
  SUPPORT_CHOICES,
  OS_CHOICES,
  type BuilderOptions,
  type CatalogOption,
} from "@/lib/phylo/catalog";
import { generateRecipe } from "@/lib/phylo/recipe";
import { notesApi } from "@/lib/local-api";

type CodeTab = "commands" | "install" | "env";

export function PhyloBuilder() {
  const [opts, setOpts] = useState<BuilderOptions>(DEFAULT_OPTIONS);
  const [codeTab, setCodeTab] = useState<CodeTab>("commands");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const recipe = useMemo(() => generateRecipe(opts), [opts]);
  const set = <K extends keyof BuilderOptions>(k: K, v: BuilderOptions[K]) =>
    setOpts((o) => ({ ...o, [k]: v }));

  const codeText =
    codeTab === "commands"
      ? recipe.commands
      : codeTab === "install"
        ? recipe.install
        : recipe.envYaml;

  const download = (name: string, body: string, type = "text/plain") => {
    const blob = new Blob([body], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const saveNote = async () => {
    await notesApi.create({
      title: "Tree-building recipe",
      description: recipe.markdown,
    });
    setSavedMsg("Saved to your notes");
    window.setTimeout(() => setSavedMsg(null), 2500);
  };

  const copyActive = async () => {
    await navigator.clipboard.writeText(codeText);
    setSavedMsg("Copied");
    window.setTimeout(() => setSavedMsg(null), 1500);
  };

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 items-start">
        {/* options */}
        <div className="border border-border rounded-2xl bg-surface-raised p-4">
          <h3 className="text-sm font-bold text-foreground mb-3">
            Choose your options
          </h3>

          <Pills label="Data type" list={DATA_TYPES} value={opts.dataType} onPick={(v) => set("dataType", v)} />
          <Pills label="What you have" list={HAVE_INPUTS} value={opts.have} onPick={(v) => set("have", v)} />

          <Field label="Scale">
            <div className="flex gap-2 items-center">
              <NumInput value={opts.nTaxa} onChange={(n) => set("nTaxa", n)} />
              <span className="text-foreground-muted text-sm">taxa</span>
              <NumInput value={opts.nSites} onChange={(n) => set("nSites", n)} />
              <span className="text-foreground-muted text-sm">sites</span>
            </div>
          </Field>

          {opts.have !== "alignment" && (
            <Pills label="Align" list={ALIGN_TOOLS} value={opts.align} onPick={(v) => set("align", v)} />
          )}
          <Pills label="Trim" list={TRIM_TOOLS} value={opts.trim} onPick={(v) => set("trim", v)} />
          <Pills label="Model selection" list={MODEL_CHOICES} value={opts.model} onPick={(v) => set("model", v)} />
          <Pills label="Inference" list={INFER_TOOLS} value={opts.infer} onPick={(v) => set("infer", v)} />
          {opts.infer === "iqtree" && (
            <Pills label="Branch support" list={SUPPORT_CHOICES} value={opts.support} onPick={(v) => set("support", v)} />
          )}
          <Pills label="Your machine" list={OS_CHOICES} value={opts.os} onPick={(v) => set("os", v)} />
        </div>

        {/* recipe */}
        <div className="lg:sticky lg:top-4">
          <h3 className="text-sm font-bold text-foreground mb-2">Your recipe</h3>
          <div className="flex gap-1 mb-2">
            {(
              [
                ["commands", "Commands"],
                ["install", "Install"],
                ["env", "environment.yml"],
              ] as [CodeTab, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setCodeTab(t)}
                className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${
                  codeTab === t
                    ? "bg-accent-soft text-accent border-accent"
                    : "bg-surface-raised text-foreground-muted border-border"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <pre className="m-0 rounded-xl p-3.5 overflow-auto max-h-[460px] text-xs leading-relaxed bg-[#0f172a] text-[#e2e8f0] whitespace-pre-wrap font-mono">
            {codeText}
          </pre>

          <div className="flex flex-wrap gap-2 mt-2.5 items-center">
            <button onClick={saveNote} className="btn-brand px-3.5 py-1.5 rounded-lg text-sm font-bold">
              Save as a note
            </button>
            <GhostBtn onClick={copyActive} icon="copy">Copy</GhostBtn>
            <GhostBtn onClick={() => download("recipe.md", recipe.markdown, "text/markdown")} icon="download">
              recipe.md
            </GhostBtn>
            <GhostBtn onClick={() => download("run.sh", recipe.runScript)} icon="download">
              run.sh
            </GhostBtn>
            <GhostBtn onClick={() => download("environment.yml", recipe.envYaml)} icon="download">
              environment.yml
            </GhostBtn>
            {savedMsg && (
              <span className="text-sm text-accent font-semibold">{savedMsg}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-xs uppercase tracking-wide text-foreground-muted font-semibold mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}

function Pills<T extends string>({
  label,
  list,
  value,
  onPick,
}: {
  label: string;
  list: CatalogOption<T>[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1.5">
        {list.map((o) => (
          <Tooltip key={o.value} label={o.hint}>
            <button
              onClick={() => onPick(o.value)}
              className={`px-2.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                value === o.value
                  ? "bg-accent text-white border-accent"
                  : "bg-surface-raised text-foreground border-border hover:border-accent"
              }`}
            >
              {o.label}
            </button>
          </Tooltip>
        ))}
      </div>
    </Field>
  );
}

function NumInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <input
      type="number"
      min={2}
      value={value}
      onChange={(e) => onChange(Math.max(2, Number(e.target.value) || 0))}
      className="w-[90px] px-2 py-1.5 rounded-lg border border-border bg-surface-raised text-foreground text-sm"
    />
  );
}

function GhostBtn({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface-raised text-foreground text-sm font-semibold hover:border-accent transition-colors"
    >
      <Icon name={icon} className="w-3.5 h-3.5" />
      {children}
    </button>
  );
}
