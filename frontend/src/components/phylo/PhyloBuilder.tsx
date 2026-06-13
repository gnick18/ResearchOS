"use client";

// The Tree Builder (frozen 2026-06-12). A choose-your-options wizard that
// generates the exact tree-building commands for three pipelines (single locus,
// concatenated supermatrix, coalescent species tree). NOTHING runs on a server,
// the recipe is text the researcher runs on their own machine. The recipe
// generator (lib/phylo/recipe.ts) is pure and shared with the BeakerBot
// plain-language path. Spec: docs/proposals/2026-06-12-phylo-wizard-build-spec.md.

import { useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  DEFAULT_OPTIONS,
  DATA_TYPES,
  ANALYSIS,
  HAVE_INPUTS,
  ALIGN_TOOLS,
  TRIM_TOOLS,
  PART_SCHEMES,
  BRLEN_MODES,
  MODEL_CHOICES,
  MODELS,
  INFER_TOOLS,
  SUPPORT_CHOICES,
  OS_CHOICES,
  type BuilderOptions,
  type CatalogOption,
  type DataType,
} from "@/lib/phylo/catalog";
import { generateRecipe } from "@/lib/phylo/recipe";
import { notesApi } from "@/lib/local-api";

type CodeTab = "commands" | "install";

export function PhyloBuilder() {
  const [opts, setOpts] = useState<BuilderOptions>(DEFAULT_OPTIONS);
  const [codeTab, setCodeTab] = useState<CodeTab>("commands");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const recipe = useMemo(() => generateRecipe(opts), [opts]);
  const set = <K extends keyof BuilderOptions>(k: K, v: BuilderOptions[K]) =>
    setOpts((o) => ({ ...o, [k]: v }));

  const isSupermatrix = opts.analysis === "supermatrix";
  const showSupport = opts.infer === "iqtree";

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

  const copyCommands = async () => {
    await navigator.clipboard.writeText(recipe.commands);
    setSavedMsg("Copied");
    window.setTimeout(() => setSavedMsg(null), 1500);
  };

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 items-start">
        {/* options */}
        <div className="border border-border rounded-2xl bg-surface-raised p-4">
          <h3 className="text-sm font-bold text-foreground mb-3">Choose your options</h3>

          <Pills label="Data type" list={DATA_TYPES} value={opts.dataType} onPick={(v) => set("dataType", v)} />
          <Pills label="Analysis" list={ANALYSIS} value={opts.analysis} onPick={(v) => set("analysis", v)} />
          <Pills label="What you have" list={HAVE_INPUTS} value={opts.have} onPick={(v) => set("have", v)} />

          {opts.have !== "alignment" && (
            <Pills label="Align" list={ALIGN_TOOLS} value={opts.align} onPick={(v) => set("align", v)} />
          )}
          <Pills label="Trim" list={TRIM_TOOLS} value={opts.trim} onPick={(v) => set("trim", v)} />

          {isSupermatrix && (
            <>
              <Pills label="Partition scheme" list={PART_SCHEMES} value={opts.partScheme} onPick={(v) => set("partScheme", v)} />
              <Pills label="Branch lengths" list={BRLEN_MODES} value={opts.brlen} onPick={(v) => set("brlen", v)} />
            </>
          )}

          <Pills label="Model selection" list={MODEL_CHOICES} value={opts.model} onPick={(v) => set("model", v)} />
          {opts.model === "fixed" && (
            <ModelPicker
              dataType={opts.dataType}
              value={opts.fixedModel}
              onChange={(v) => set("fixedModel", v)}
            />
          )}

          <Pills label="Inference" list={INFER_TOOLS} value={opts.infer} onPick={(v) => set("infer", v)} />
          {showSupport && (
            <Pills label="Branch support" list={SUPPORT_CHOICES} value={opts.support} onPick={(v) => set("support", v)} />
          )}

          <Field label="Outgroup (optional)">
            <input
              type="text"
              value={opts.outgroup}
              onChange={(e) => set("outgroup", e.target.value)}
              placeholder="A taxon name to root the tree"
              className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface-raised text-foreground text-sm"
            />
          </Field>

          <Pills label="Your machine" list={OS_CHOICES} value={opts.os} onPick={(v) => set("os", v)} />

          <button
            onClick={() => setShowAdvanced((s) => !s)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent mt-1"
          >
            <Icon
              name="chevronDown"
              className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
            {showAdvanced ? "Hide advanced options" : "Show advanced options"}
          </button>

          {showAdvanced && (
            <div className="mt-3 border-t border-border pt-3">
              <Toggle
                label="UFBoot --bnni"
                hint="Reduce the risk of overestimated UFBoot support"
                value={opts.bnni}
                onChange={(v) => set("bnni", v)}
              />
              <NumField
                label="UFBoot replicates"
                hint="Ultrafast bootstrap replicate count (-B)"
                value={opts.ufbootReps}
                onChange={(n) => set("ufbootReps", n)}
              />
              <NumField
                label="Standard bootstrap replicates"
                hint="Classic nonparametric bootstrap count (-b)"
                value={opts.bsReps}
                onChange={(n) => set("bsReps", n)}
              />
              <Toggle
                label="Restrict ModelFinder"
                hint="Limit the model search to a common set (-mset)"
                value={opts.restrictModels}
                onChange={(v) => set("restrictModels", v)}
              />
              <Toggle
                label="Ascertainment bias +ASC"
                hint="For datasets with only variable sites (SNPs)"
                value={opts.asc}
                onChange={(v) => set("asc", v)}
              />
              <Field label="Threads">
                <input
                  type="text"
                  value={opts.threads}
                  onChange={(e) => set("threads", e.target.value.trim() || "AUTO")}
                  placeholder="AUTO or a number"
                  className="w-[140px] px-2.5 py-1.5 rounded-lg border border-border bg-surface-raised text-foreground text-sm"
                />
              </Field>
            </div>
          )}
        </div>

        {/* recipe */}
        <div className="lg:sticky lg:top-4">
          <h3 className="text-sm font-bold text-foreground mb-2">Your recipe</h3>
          <div className="flex gap-1 mb-2">
            {(
              [
                ["commands", "Commands"],
                ["install", "Install"],
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

          {codeTab === "commands" ? (
            <>
              <pre className="m-0 rounded-xl p-3.5 overflow-auto max-h-[460px] text-xs leading-relaxed bg-[#0f172a] text-[#e2e8f0] whitespace-pre-wrap font-mono">
                {recipe.commands}
              </pre>
              <div className="flex flex-wrap gap-2 mt-2.5 items-center">
                <button onClick={saveNote} className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 px-3.5 py-1.5 rounded-lg text-sm font-bold">
                  Save as a note
                </button>
                <GhostBtn onClick={copyCommands} icon="copy">Copy</GhostBtn>
                <GhostBtn onClick={() => download("run.sh", recipe.runScript)} icon="download">
                  run.sh
                </GhostBtn>
                {savedMsg && (
                  <span className="text-sm text-accent font-semibold">{savedMsg}</span>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs uppercase tracking-wide text-foreground-muted font-semibold mb-1.5">
                Setup
              </div>
              <pre className="m-0 rounded-xl p-3.5 overflow-auto max-h-[220px] text-xs leading-relaxed bg-[#0f172a] text-[#e2e8f0] whitespace-pre-wrap font-mono">
                {recipe.install}
              </pre>
              <div className="text-xs uppercase tracking-wide text-foreground-muted font-semibold mt-3 mb-1.5">
                environment.yml
              </div>
              <pre className="m-0 rounded-xl p-3.5 overflow-auto max-h-[220px] text-xs leading-relaxed bg-[#0f172a] text-[#e2e8f0] whitespace-pre-wrap font-mono">
                {recipe.envYaml}
              </pre>
              <div className="flex flex-wrap gap-2 mt-2.5 items-center">
                <GhostBtn onClick={() => download("environment.yml", recipe.envYaml)} icon="download">
                  environment.yml
                </GhostBtn>
                {savedMsg && (
                  <span className="text-sm text-accent font-semibold">{savedMsg}</span>
                )}
              </div>
            </>
          )}
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

/** Filter-as-you-type model picker over the preset list, free text also allowed. */
function ModelPicker({
  dataType,
  value,
  onChange,
}: {
  dataType: DataType;
  value: string;
  onChange: (v: string) => void;
}) {
  const [query, setQuery] = useState("");
  const presets = MODELS[dataType];
  const matches = presets.filter((m) => m.toLowerCase().includes(query.toLowerCase()));

  return (
    <Field label="Substitution model">
      <div className="relative mb-2">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-muted">
          <Icon name="search" className="w-3.5 h-3.5" />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim()) onChange(e.target.value.trim());
          }}
          placeholder="Type a model or filter the list"
          className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-border bg-surface-raised text-foreground text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {matches.map((m) => (
          <button
            key={m}
            onClick={() => {
              onChange(m);
              setQuery("");
            }}
            className={`px-2.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
              value === m
                ? "bg-accent text-white border-accent"
                : "bg-surface-raised text-foreground border-border hover:border-accent"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="text-xs text-foreground-muted mt-2">
        Using <span className="font-semibold text-foreground">{value || "(none)"}</span>
      </div>
    </Field>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <Tooltip label={hint}>
        <span className="text-sm font-semibold text-foreground">{label}</span>
      </Tooltip>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          value ? "bg-accent" : "bg-border"
        }`}
        aria-pressed={value}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            value ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}

function NumField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <Tooltip label={hint}>
        <span className="text-sm font-semibold text-foreground">{label}</span>
      </Tooltip>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
        className="w-[100px] px-2 py-1.5 rounded-lg border border-border bg-surface-raised text-foreground text-sm"
      />
    </div>
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
