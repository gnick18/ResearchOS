"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import type {
  CodingWorkflowLanguage,
  CodingWorkflowOutputRenderer,
} from "@/lib/types";

/** Curated language list — driven by the registry's lock decisions
 *  (see METHODS_EXPANSION_V2_PROPOSAL.md §3). Display names follow the
 *  canonical capitalization for each. */
const LANGUAGE_OPTIONS: Array<{ value: CodingWorkflowLanguage; label: string; hljs: string }> = [
  { value: "python", label: "Python", hljs: "python" },
  { value: "r", label: "R", hljs: "r" },
  { value: "bash", label: "Bash / shell", hljs: "bash" },
  { value: "sql", label: "SQL", hljs: "sql" },
  { value: "julia", label: "Julia", hljs: "julia" },
  { value: "matlab", label: "MATLAB", hljs: "matlab" },
  { value: "javascript", label: "JavaScript", hljs: "javascript" },
  { value: "other", label: "Other (specify)", hljs: "plaintext" },
];

export function highlightHintFor(
  language: CodingWorkflowLanguage,
  languageLabel?: string | null,
): string {
  if (language === "other") {
    return (languageLabel ?? "").trim() || "plaintext";
  }
  return LANGUAGE_OPTIONS.find((o) => o.value === language)?.hljs ?? "plaintext";
}

export interface CodingWorkflowEditorProps {
  language: CodingWorkflowLanguage;
  onLanguageChange?: (lang: CodingWorkflowLanguage) => void;
  languageLabel: string | null;
  onLanguageLabelChange?: (label: string | null) => void;
  embeddedCode: string | null;
  onEmbeddedCodeChange?: (code: string | null) => void;
  externalPath: string | null;
  onExternalPathChange?: (path: string | null) => void;
  description: string | null;
  onDescriptionChange?: (desc: string | null) => void;
  outputRenderer: CodingWorkflowOutputRenderer;
  onOutputRendererChange?: (renderer: CodingWorkflowOutputRenderer) => void;
  readOnly?: boolean;
}

/**
 * Shared form for creating or editing a coding workflow. Q-B5 lock: the
 * code textarea is a plain <textarea>, no Monaco/CodeMirror. Inline
 * preview uses rehype-highlight (already a dep — same path the markdown
 * editor's fenced-code blocks take).
 */
export default function CodingWorkflowEditor({
  language,
  onLanguageChange,
  languageLabel,
  onLanguageLabelChange,
  embeddedCode,
  onEmbeddedCodeChange,
  externalPath,
  onExternalPathChange,
  description,
  onDescriptionChange,
  outputRenderer,
  onOutputRendererChange,
  readOnly = false,
}: CodingWorkflowEditorProps) {
  const hint = highlightHintFor(language, languageLabel);

  // Embedded code goes through the markdown renderer as a fenced code
  // block so rehype-highlight applies the same highlight.js theme as the
  // rest of the app. Reuses the wider markdown sanitize schema so any
  // future schema tightening (rehype-sanitize landed via security audit)
  // applies here too.
  const previewMarkdown = useMemo(() => {
    if (!embeddedCode || !embeddedCode.trim()) return null;
    return "```" + hint + "\n" + embeddedCode + "\n```";
  }, [embeddedCode, hint]);

  const showIpynbHint =
    outputRenderer === "ipynb" ||
    (language === "python" &&
      externalPath != null &&
      externalPath.toLowerCase().endsWith(".ipynb"));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Language</label>
          <select
            value={language}
            onChange={(e) =>
              onLanguageChange?.(e.target.value as CodingWorkflowLanguage)
            }
            disabled={readOnly || !onLanguageChange}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {language === "other" && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Language label
            </label>
            <input
              type="text"
              value={languageLabel ?? ""}
              onChange={(e) =>
                onLanguageLabelChange?.(e.target.value || null)
              }
              disabled={readOnly || !onLanguageLabelChange}
              placeholder="e.g. Snakemake, Nextflow"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Description (optional)
        </label>
        <textarea
          value={description ?? ""}
          onChange={(e) => onDescriptionChange?.(e.target.value || null)}
          disabled={readOnly || !onDescriptionChange}
          rows={2}
          placeholder="One-line summary of what this script does — surfaced in the methods list."
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Embedded code
        </label>
        <textarea
          value={embeddedCode ?? ""}
          onChange={(e) => onEmbeddedCodeChange?.(e.target.value || null)}
          disabled={readOnly || !onEmbeddedCodeChange}
          rows={14}
          spellCheck={false}
          placeholder="# Paste your script here, or leave blank and set External path below."
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
        />
        <p className="text-xs text-gray-400 mt-1">
          Plain textarea — no inline editor by design (Q-B5 lock). Edit
          externally and paste here, or use the External path below for the
          open-in-editor handoff.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          External path (optional)
        </label>
        <input
          type="text"
          value={externalPath ?? ""}
          onChange={(e) => onExternalPathChange?.(e.target.value || null)}
          disabled={readOnly || !onExternalPathChange}
          placeholder="e.g. /Users/you/scripts/qc.py or analyses/growth-curve.ipynb"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 font-mono"
        />
        <p className="text-xs text-gray-400 mt-1">
          Free-text path on your machine. ResearchOS does not open this for
          you (the browser FSA has no access outside the data folder); copy
          it into your editor manually.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Inline preview renderer
        </label>
        <div className="flex items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="output-renderer"
              checked={outputRenderer === "syntax-highlight"}
              onChange={() => onOutputRendererChange?.("syntax-highlight")}
              disabled={readOnly || !onOutputRendererChange}
            />
            <span>Syntax-highlighted code</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="output-renderer"
              checked={outputRenderer === "ipynb"}
              onChange={() => onOutputRendererChange?.("ipynb")}
              disabled={readOnly || !onOutputRendererChange}
            />
            <span>Jupyter notebook (.ipynb)</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="output-renderer"
              checked={outputRenderer === null}
              onChange={() => onOutputRendererChange?.(null)}
              disabled={readOnly || !onOutputRendererChange}
            />
            <span>No inline preview</span>
          </label>
        </div>
        {showIpynbHint && (
          <p className="text-xs text-cyan-600 mt-1">
            Paste the .ipynb JSON into the Embedded code field above —
            cells will render stacked with their last-saved outputs.
          </p>
        )}
      </div>

      {previewMarkdown && outputRenderer === "syntax-highlight" && (
        <div className="border border-gray-100 rounded-lg overflow-hidden">
          <div className="text-xs px-3 py-1.5 bg-gray-50 text-gray-500 border-b border-gray-100">
            Preview
          </div>
          <div className="p-3 text-xs overflow-x-auto">
            <ReactMarkdown
              rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema], rehypeHighlight]}
            >
              {previewMarkdown}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
