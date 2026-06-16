"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import remarkUnderline from "@/lib/markdown/remark-underline";
import { codingWorkflowApi, methodsApi as rawMethodsApi } from "@/lib/local-api";
import type {
  CodingWorkflowLanguage,
  CodingWorkflowOutputRenderer,
  CodingWorkflowProtocol,
  Method,
  MethodUpdate,
} from "@/lib/types";
import { getMethodTypeMeta } from "@/lib/methods/method-type-registry";
import UnifiedShareDialog from "@/components/sharing/UnifiedShareDialog";
import Tooltip from "@/components/Tooltip";
import CodingWorkflowEditor, { highlightHintFor } from "@/components/CodingWorkflowEditor";
import { GlobeIcon, LockIcon } from "@/lib/utils/icons";
import { parseNotebook, type ParsedNbCell, type ParsedNbOutput } from "@/lib/methods/ipynb-parser";
import { useMethodPermissions } from "@/hooks/useMethodPermissions";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import { isWholeLabShared } from "@/lib/sharing/unified";

export interface CodingWorkflowViewerProps {
  method: Method;
  currentUser: string;
  onClose: () => void;
  onDelete: (id: number) => void;
}

function effectiveOwnerOf(method: Method): string | undefined {
  return method.is_shared_with_me && method.shared_permission === "edit"
    ? method.owner
    : undefined;
}

function ownerScopedMethodsApi(method: Method) {
  const owner = effectiveOwnerOf(method);
  return {
    ...rawMethodsApi,
    get: (id: number) => rawMethodsApi.get(id, owner),
    update: (id: number, data: MethodUpdate) => rawMethodsApi.update(id, data, owner),
  };
}

function extractProtocolId(sourcePath: string | null | undefined): number | null {
  if (!sourcePath) return null;
  const match = sourcePath.match(/^coding_workflow:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export default function CodingWorkflowViewer({
  method,
  currentUser,
  onClose,
  onDelete,
}: CodingWorkflowViewerProps) {
  const queryClient = useQueryClient();
  const { canModifyMethod } = useMethodPermissions();
  const { canShare } = useAccountCapabilities();
  const meta = getMethodTypeMeta("coding_workflow");
  const [currentMethod, setCurrentMethod] = useState(method);
  const [protocol, setProtocol] = useState<CodingWorkflowProtocol | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSharePopup, setShowSharePopup] = useState(false);

  const [language, setLanguage] = useState<CodingWorkflowLanguage>("python");
  const [languageLabel, setLanguageLabel] = useState<string | null>(null);
  const [embeddedCode, setEmbeddedCode] = useState<string | null>(null);
  const [externalPath, setExternalPath] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [outputRenderer, setOutputRenderer] = useState<CodingWorkflowOutputRenderer>(
    "syntax-highlight",
  );

  const scopedMethodsApi = useMemo(() => ownerScopedMethodsApi(currentMethod), [currentMethod]);

  const protocolId = extractProtocolId(method.source_path);
  const protocolOwner = method.owner || undefined;

  useEffect(() => {
    if (protocolId === null) {
      setLoading(false);
      return;
    }
    codingWorkflowApi
      .get(protocolId, protocolOwner)
      .then((data) => {
        if (!data) {
          setLoading(false);
          return;
        }
        setProtocol(data);
        setLanguage(data.language);
        setLanguageLabel(data.language_label ?? null);
        setEmbeddedCode(data.embedded_code ?? null);
        setExternalPath(data.external_path ?? null);
        setDescription(data.description ?? null);
        setOutputRenderer(data.output_renderer ?? "syntax-highlight");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [protocolId, protocolOwner]);

  const handleSaveAll = useCallback(async () => {
    if (protocolId === null) return;
    setSaving(true);
    try {
      await codingWorkflowApi.update(
        protocolId,
        {
          language,
          language_label: languageLabel,
          embedded_code: embeddedCode,
          external_path: externalPath,
          description,
          output_renderer: outputRenderer,
        },
        protocolOwner,
      );
      await queryClient.refetchQueries({ queryKey: ["methods"] });
    } finally {
      setSaving(false);
    }
  }, [
    protocolId,
    protocolOwner,
    language,
    languageLabel,
    embeddedCode,
    externalPath,
    description,
    outputRenderer,
    queryClient,
  ]);

  // R1c: unified canWrite gate.
  const canModify = canModifyMethod(currentMethod);
  const isWholeLab =
    currentMethod.is_public || isWholeLabShared(currentMethod.shared_with);

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-body font-semibold text-foreground">{currentMethod.name}</h3>
            <p className="text-meta text-foreground-muted mt-0.5">{meta.label}</p>
          </div>
          <div className="flex items-center gap-2">
            {canModify && !currentMethod.is_shared_with_me && canShare && (
              <Tooltip label="Share method" placement="bottom">
                <button
                  onClick={() => setShowSharePopup(true)}
                  className={`px-3 py-1.5 text-meta rounded-lg ${
                    isWholeLab
                      ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-500/20"
                      : "bg-surface-sunken text-foreground-muted hover:bg-foreground-muted/15"
                  }`}
                >
                  <span className="flex items-center gap-1">
                    {isWholeLab ? <GlobeIcon /> : <LockIcon />}
                    {isWholeLab ? "Public" : "Private"}
                  </span>
                </button>
              </Tooltip>
            )}
            {canModify && (
              <button
                onClick={() => onDelete(currentMethod.id)}
                className="px-3 py-1.5 text-meta text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                Delete
              </button>
            )}
            <button
              onClick={handleSaveAll}
              disabled={saving || loading || protocolId === null}
              className="ros-btn-raise px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-foreground-muted hover:text-foreground text-heading ml-2"
              >
                ✕
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-body text-foreground-muted animate-pulse">Loading coding workflow…</p>
          ) : !protocol ? (
            <div className="text-center py-8">
              <p className="text-body text-foreground-muted">
                Coding workflow not found. It may have been deleted.
              </p>
            </div>
          ) : (
            <CodingWorkflowEditor
              language={language}
              onLanguageChange={canModify ? setLanguage : undefined}
              languageLabel={languageLabel}
              onLanguageLabelChange={canModify ? setLanguageLabel : undefined}
              embeddedCode={embeddedCode}
              onEmbeddedCodeChange={canModify ? setEmbeddedCode : undefined}
              externalPath={externalPath}
              onExternalPathChange={canModify ? setExternalPath : undefined}
              description={description}
              onDescriptionChange={canModify ? setDescription : undefined}
              outputRenderer={outputRenderer}
              onOutputRendererChange={canModify ? setOutputRenderer : undefined}
              readOnly={!canModify}
            />
          )}
        </div>
      </div>

      {/* Unified Share dialog. The viewer's Public / Private pill opens this
          two-tab surface (lab ACL + cross-boundary send) instead of the bare
          lab-ACL dialog, matching the method viewer's action-strip Share
          button (Unified Share entry point, 2026-06-04). */}
      {showSharePopup && (
        <UnifiedShareDialog
          isOpen
          target={{
            kind: "method",
            method: currentMethod,
            owner:
              currentMethod.owner || currentMethod.created_by || currentUser,
          }}
          onClose={() => setShowSharePopup(false)}
          onShared={() => {
            queryClient.refetchQueries({ queryKey: ["methods"] });
            scopedMethodsApi.get(currentMethod.id).then((updatedMethod) => {
              if (updatedMethod) setCurrentMethod(updatedMethod);
            });
          }}
        />
      )}
    </>
  );
}

/** Read-only render of a parsed notebook cell (or a syntax-highlighted
 *  embedded code body) — reused by `CodingWorkflowMethodTabContent` and
 *  potentially future wiki pages. Kept in this file because the viewer
 *  + the tab-content surface both need the same code path and the parser
 *  output is small enough not to warrant a third file. */
export function CodingWorkflowRenderer({
  language,
  languageLabel,
  embeddedCode,
  externalPath,
  outputRenderer,
  description,
}: {
  language: CodingWorkflowLanguage;
  languageLabel: string | null;
  embeddedCode: string | null;
  externalPath: string | null;
  outputRenderer: CodingWorkflowOutputRenderer;
  description: string | null;
}) {
  const hint = highlightHintFor(language, languageLabel);

  const parsedNotebook = useMemo(() => {
    if (outputRenderer !== "ipynb" || !embeddedCode) return null;
    return parseNotebook(embeddedCode);
  }, [outputRenderer, embeddedCode]);

  return (
    <div className="space-y-4">
      {description && (
        <p className="text-body text-foreground-muted">{description}</p>
      )}
      {externalPath && (
        <div className="rounded-lg border border-cyan-100 bg-cyan-50 dark:bg-cyan-500/10 px-3 py-2 text-meta">
          <div className="font-medium text-cyan-700 dark:text-cyan-300">Open in your editor</div>
          <code className="block mt-0.5 font-mono text-cyan-800 dark:text-cyan-200 break-all">
            {externalPath}
          </code>
          <p className="text-cyan-700 dark:text-cyan-300/70 mt-1">
            Copy this path into your editor — the browser cannot open files
            outside the data folder for you.
          </p>
        </div>
      )}
      {!embeddedCode && !externalPath && (
        <p className="text-meta text-foreground-muted italic">
          No embedded code or external path set yet.
        </p>
      )}
      {outputRenderer === "syntax-highlight" && embeddedCode && (
        <div className="text-meta overflow-x-auto">
          <ReactMarkdown
            rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema], rehypeHighlight]}
          >
            {"```" + hint + "\n" + embeddedCode + "\n```"}
          </ReactMarkdown>
        </div>
      )}
      {outputRenderer === "ipynb" && parsedNotebook && (
        <NotebookRender result={parsedNotebook} hint={hint} />
      )}
    </div>
  );
}

function NotebookRender({
  result,
  hint,
}: {
  result: ReturnType<typeof parseNotebook>;
  hint: string;
}) {
  if (result.error) {
    return (
      <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 text-meta text-amber-700 dark:text-amber-300">
        Could not parse notebook: {result.error}
      </div>
    );
  }
  if (!result.notebook) return null;
  const { cells, warnings } = result.notebook;
  return (
    <div className="space-y-3">
      {warnings.length > 0 && (
        <details className="text-meta text-amber-700 dark:text-amber-300">
          <summary className="cursor-pointer">
            {warnings.length} parse warning{warnings.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 pl-4 list-disc">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      {cells.map((cell, i) => (
        <NotebookCell key={i} cell={cell} hint={hint} />
      ))}
    </div>
  );
}

function NotebookCell({ cell, hint }: { cell: ParsedNbCell; hint: string }) {
  if (cell.cellType === "markdown") {
    return (
      <div className="rounded-lg border border-border p-3 bg-surface-raised">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkUnderline]}
          rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema], rehypeHighlight]}
        >
          {cell.source}
        </ReactMarkdown>
      </div>
    );
  }
  if (cell.cellType === "raw") {
    return (
      <pre className="text-meta bg-surface-sunken border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
        {cell.source}
      </pre>
    );
  }
  // code cell
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1 bg-surface-sunken border-b border-border text-meta text-foreground-muted">
        <span className="font-mono">
          In [{cell.executionCount ?? " "}]:
        </span>
      </div>
      <div className="text-meta overflow-x-auto">
        <ReactMarkdown
          rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema], rehypeHighlight]}
        >
          {"```" + hint + "\n" + cell.source + "\n```"}
        </ReactMarkdown>
      </div>
      {cell.outputs.length > 0 && (
        <div className="border-t border-border bg-surface-sunken/40">
          {cell.outputs.map((o, i) => (
            <NotebookOutputView key={i} output={o} />
          ))}
        </div>
      )}
    </div>
  );
}

function NotebookOutputView({ output }: { output: ParsedNbOutput }) {
  if (output.kind === "image") {
    return (
      <div className="p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- src is an inline data: URL from a Jupyter notebook output; next/image cannot optimize base64 data URLs and intrinsic dimensions are unknown */}
        <img
          src={`data:${output.mimeType};base64,${output.payload}`}
          alt="notebook output"
          className="max-w-full h-auto"
        />
      </div>
    );
  }
  if (output.kind === "html") {
    // HTML outputs route through the same rehype-sanitize schema the
    // markdown body uses — keeps notebook outputs at the same trust
    // boundary as user-authored markdown.
    return (
      <div className="p-3 text-meta overflow-x-auto">
        <ReactMarkdown
          rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
        >
          {output.payload}
        </ReactMarkdown>
      </div>
    );
  }
  // text / stream
  const isStderr = output.mimeType === "stderr";
  return (
    <pre
      className={`text-meta p-3 overflow-x-auto whitespace-pre-wrap ${
        isStderr ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10" : "text-foreground"
      }`}
    >
      {output.payload}
    </pre>
  );
}
