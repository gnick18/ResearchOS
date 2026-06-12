"use client";

// Chemistry Phase 3 (2026-06-11). The shared "Insert reference" picker.
//
// A modal with a tab strip (Molecules / Sequences / Methods), a search box, and
// a scrollable list. Clicking a row calls back with objectReferenceMarkdown(...)
// and closes. The Molecules tab is gated on CHEMISTRY_ENABLED; if chemistry is
// off, the picker defaults to Sequences and hides the Molecules tab.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { objectReferenceMarkdown } from "@/lib/references";
import { CHEMISTRY_ENABLED } from "@/lib/chemistry/config";
import { MoleculeThumbnail } from "@/components/chemistry/MoleculeThumbnail";
import type { Molecule } from "@/lib/chemistry/api";
import type { SequenceRecord, Method } from "@/lib/types";

// Lazy to avoid importing heavy APIs at parse time (the wasm etc.) when the
// picker has never been opened.
async function loadData(): Promise<{
  molecules: Molecule[];
  sequences: SequenceRecord[];
  methods: Method[];
}> {
  const [{ moleculesApi }, { sequencesApi, methodsApi }] = await Promise.all([
    import("@/lib/chemistry/api"),
    import("@/lib/local-api"),
  ]);
  const [molecules, sequences, methods] = await Promise.all([
    CHEMISTRY_ENABLED ? moleculesApi.list() : Promise.resolve([] as Molecule[]),
    sequencesApi.list(),
    methodsApi.list(),
  ]);
  return { molecules, sequences, methods };
}

type Tab = "molecules" | "sequences" | "methods";

const defaultTab: Tab = CHEMISTRY_ENABLED ? "molecules" : "sequences";

interface ReferencePickerProps {
  /** Called with the objectReferenceMarkdown(...) string on row click, then the
   *  picker closes automatically via onClose. */
  onPick: (markdown: string) => void;
  onClose: () => void;
}

/** A single item row in the picker list. */
function PickerRow({
  thumbnail,
  label,
  sublabel,
  onClick,
}: {
  thumbnail?: React.ReactNode;
  label: string;
  sublabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-accent-soft transition-colors group"
    >
      {thumbnail && (
        <div className="shrink-0 w-10 h-10 rounded overflow-hidden bg-white border border-border flex items-center justify-center">
          {thumbnail}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-foreground truncate">{label}</p>
        {sublabel && (
          <p className="text-meta text-foreground-muted truncate">{sublabel}</p>
        )}
      </div>
    </button>
  );
}

export default function ReferencePicker({ onPick, onClose }: ReferencePickerProps) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [molecules, setMolecules] = useState<Molecule[]>([]);
  const [sequences, setSequences] = useState<SequenceRecord[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load data once on mount.
  useEffect(() => {
    let cancelled = false;
    loadData()
      .then((data) => {
        if (cancelled) return;
        setMolecules(data.molecules);
        setSequences(data.sequences);
        setMethods(data.methods);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus the search box as soon as the panel mounts.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  // Click-outside to close.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const pick = useCallback(
    (markdown: string) => {
      onPick(markdown);
      onClose();
    },
    [onPick, onClose],
  );

  const q = query.trim().toLowerCase();

  const filteredMolecules = molecules.filter(
    (m) =>
      !q ||
      m.name.toLowerCase().includes(q) ||
      (m.formula ?? "").toLowerCase().includes(q) ||
      (m.smiles ?? "").toLowerCase().includes(q),
  );

  const filteredSequences = sequences.filter(
    (s) =>
      !q ||
      (s.display_name ?? "").toLowerCase().includes(q) ||
      (s.seq_type ?? "").toLowerCase().includes(q),
  );

  const filteredMethods = methods.filter(
    (m) =>
      !q ||
      (m.name ?? "").toLowerCase().includes(q) ||
      (m.method_type ?? "").toLowerCase().includes(q),
  );

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    ...(CHEMISTRY_ENABLED
      ? [{ id: "molecules" as Tab, label: "Molecules", count: filteredMolecules.length }]
      : []),
    { id: "sequences" as Tab, label: "Sequences", count: filteredSequences.length },
    { id: "methods" as Tab, label: "Methods", count: filteredMethods.length },
  ];

  return (
    // Backdrop: transparent so the editor stays in view; the panel itself has
    // the background. Fixed overlay to receive outside-click events.
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Insert reference"
        className="w-full max-w-md bg-surface-raised border border-border rounded-xl shadow-2xl flex flex-col max-h-[70vh]"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-border shrink-0">
          <Icon name="book" className="w-4 h-4 text-foreground-muted" />
          <span className="text-body font-semibold text-foreground flex-1">
            Insert reference
          </span>
          <Tooltip label="Close" placement="left">
            <button
              type="button"
              aria-label="Close reference picker"
              onClick={onClose}
              className="p-1 rounded hover:bg-accent-soft text-foreground-muted hover:text-foreground transition-colors"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        {/* Search */}
        <div className="px-4 py-2 shrink-0">
          <div className="relative">
            <Icon
              name="search"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted pointer-events-none"
            />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search by name or type…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-body text-foreground bg-surface border border-border rounded-lg outline-none focus:border-brand-action placeholder:text-foreground-muted"
            />
          </div>
        </div>

        {/* Tab strip */}
        <div className="flex items-center gap-1 px-4 pb-2 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1 text-meta rounded-md transition-colors font-medium ${
                tab === t.id
                  ? "bg-brand-action text-white"
                  : "text-foreground-muted hover:bg-accent-soft hover:text-foreground"
              }`}
            >
              {t.label}
              {!loading && (
                <span className="ml-1.5 text-[11px] opacity-70">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
          {loading ? (
            <p className="text-meta text-foreground-muted py-4 text-center">
              Loading…
            </p>
          ) : tab === "molecules" && CHEMISTRY_ENABLED ? (
            filteredMolecules.length === 0 ? (
              <p className="text-meta text-foreground-muted py-4 text-center">
                {q ? "No molecules match that search." : "No molecules in your library yet."}
              </p>
            ) : (
              <div className="space-y-0.5">
                {filteredMolecules.map((m) => (
                  <PickerRow
                    key={m.id}
                    thumbnail={
                      m.smiles ? (
                        <MoleculeThumbnail
                          structure={m.smiles}
                          width={40}
                          height={40}
                        />
                      ) : undefined
                    }
                    label={m.name}
                    sublabel={[m.formula, m.smiles ? "SMILES" : undefined]
                      .filter(Boolean)
                      .join(" · ")}
                    onClick={() =>
                      pick(objectReferenceMarkdown("molecule", m.id, m.name))
                    }
                  />
                ))}
              </div>
            )
          ) : tab === "sequences" ? (
            filteredSequences.length === 0 ? (
              <p className="text-meta text-foreground-muted py-4 text-center">
                {q ? "No sequences match that search." : "No sequences in your library yet."}
              </p>
            ) : (
              <div className="space-y-0.5">
                {filteredSequences.map((s) => (
                  <PickerRow
                    key={s.id}
                    label={s.display_name ?? `Sequence ${s.id}`}
                    sublabel={s.seq_type ?? undefined}
                    onClick={() =>
                      pick(
                        objectReferenceMarkdown(
                          "sequence",
                          String(s.id),
                          s.display_name ?? `Sequence ${s.id}`,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            )
          ) : tab === "methods" ? (
            filteredMethods.length === 0 ? (
              <p className="text-meta text-foreground-muted py-4 text-center">
                {q ? "No methods match that search." : "No methods in your library yet."}
              </p>
            ) : (
              <div className="space-y-0.5">
                {filteredMethods.map((m) => (
                  <PickerRow
                    key={m.id}
                    label={m.name}
                    sublabel={m.method_type ?? undefined}
                    onClick={() =>
                      pick(
                        objectReferenceMarkdown("method", String(m.id), m.name),
                      )
                    }
                  />
                ))}
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
