"use client";

// Import a structure file into the library (chemistry-workbench Phase 1). Drop or
// pick a .mol / .sdf / .smi / .smiles file; the structures are parsed
// (lib/chemistry/import-file), SMILES normalized to a Molfile via RDKit, and each
// added to the library with source "imported". ChemDraw + unknown formats get an
// honest message, never a silent drop.

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import { moleculesApi } from "@/lib/chemistry/api";
import { toMolblock } from "@/lib/chemistry/rdkit";
import { parseStructureFile, type ParseResult } from "@/lib/chemistry/import-file";

export function ImportFileDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const takeFile = useCallback(async (file: File) => {
    setSummary(null);
    setFileName(file.name);
    const text = await file.text();
    setParsed(parseStructureFile(file.name, text));
  }, []);

  const handleImport = useCallback(async () => {
    if (!parsed || !parsed.structures.length || importing) return;
    setImporting(true);
    let ok = 0;
    let failed = 0;
    for (const s of parsed.structures) {
      try {
        const molblock = s.isMolblock ? s.structure : await toMolblock(s.structure);
        await moleculesApi.create(molblock, { name: s.name, source: "imported" });
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["molecules"] });
    setImporting(false);
    if (failed === 0) {
      onClose();
    } else {
      setSummary(
        `Imported ${ok} structure${ok === 1 ? "" : "s"}. ${failed} could not be parsed by RDKit and were skipped.`,
      );
      setParsed(null);
    }
  }, [parsed, importing, queryClient, onClose]);

  const reset = () => {
    setFileName(null);
    setParsed(null);
    setSummary(null);
  };

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Import a structure file"
      widthClassName="max-w-lg"
      card={false}
    >
      <div className="bg-surface-raised rounded-xl shadow-2xl w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-surface-sunken">
          <h3 className="text-title font-bold text-foreground">
            Import a structure file
          </h3>
          <p className="text-meta text-foreground-muted mt-0.5">
            .mol, .sdf, .smi, and .smiles. Everything is parsed in your browser.
          </p>
        </div>

        <div className="px-5 py-4">
          <input
            ref={inputRef}
            type="file"
            accept=".mol,.sdf,.smi,.smiles,.txt,.cdxml,.cdx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void takeFile(f);
              e.target.value = "";
            }}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void takeFile(f);
            }}
            className={`w-full border border-dashed rounded-xl px-6 py-8 text-center transition-colors ${
              dragOver
                ? "border-brand-action bg-accent-soft"
                : "border-border bg-surface-sunken hover:border-brand-action"
            }`}
          >
            <Icon
              name="download"
              className="w-7 h-7 mx-auto mb-2 text-foreground-muted"
            />
            <div className="text-body font-semibold text-foreground">
              Drop a file here, or click to choose
            </div>
            <div className="text-meta text-foreground-muted mt-1">
              {fileName ?? ".mol / .sdf / .smi / .smiles"}
            </div>
          </button>

          {summary ? (
            <p className="text-meta text-foreground-muted mt-4">{summary}</p>
          ) : parsed?.unsupported ? (
            <p className="text-meta text-amber-700 dark:text-amber-300 mt-4">
              {parsed.unsupported}
            </p>
          ) : parsed && parsed.structures.length > 0 ? (
            <div className="mt-4">
              <p className="text-meta text-foreground mb-2">
                Found{" "}
                <span className="font-bold">{parsed.structures.length}</span>{" "}
                structure{parsed.structures.length === 1 ? "" : "s"}.
              </p>
              <ul className="text-meta text-foreground-muted max-h-32 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                {parsed.structures.slice(0, 50).map((s, i) => (
                  <li key={i} className="px-3 py-1.5 truncate">
                    {s.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-border bg-surface-sunken">
          <button
            type="button"
            onClick={summary ? reset : onClose}
            className="px-4 py-2 text-body text-foreground-muted hover:text-foreground hover:bg-surface-raised rounded-lg transition-colors"
          >
            {summary ? "Import another" : "Cancel"}
          </button>
          <div className="flex-1" />
          {parsed && parsed.structures.length > 0 && !summary ? (
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="inline-flex items-center gap-2 px-4 py-2 text-body font-semibold text-white rounded-lg bg-gradient-to-br from-brand-action to-brand-purple disabled:opacity-60"
            >
              <Icon name="download" className="w-4 h-4" />
              {importing
                ? "Importing…"
                : `Import ${parsed.structures.length} to library`}
            </button>
          ) : null}
        </div>
      </div>
    </LivingPopup>
  );
}
