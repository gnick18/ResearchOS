"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { filesApi, tasksApi, pcrApi, fetchAllMethodsIncludingShared } from "@/lib/local-api";
import { migrateNoteImages } from "@/lib/notes/migrate-images";
import type { Method, Task, TaskMethodAttachment, PCRProtocol, PCRGradient, PCRIngredient } from "@/lib/types";
import { InteractiveGradientEditor } from "@/components/InteractiveGradientEditor";
import LiveMarkdownEditor from "./LiveMarkdownEditor";
import MethodPicker from "./MethodPicker";
import Tooltip from "./Tooltip";
import { useDropWarning } from "@/lib/use-drop-warning";

interface MethodTabsProps {
  task: Task;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean; // When true, all editing is disabled (for lab mode)
}

// Helper to generate unique ID for new ingredients
function generateIngredientId(): string {
  return `ing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Helper function to extract PCR protocol ID from source_path
function extractPCRProtocolId(sourcePath: string): number | null {
  const match = sourcePath.match(/^pcr:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export default function MethodTabs({ task, onTaskUpdate, readOnly = false }: MethodTabsProps) {
  const queryClient = useQueryClient();
  const [activeMethodId, setActiveMethodId] = useState<number | null>(null);
  const [showMethodSelector, setShowMethodSelector] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Get method attachments from task
  const methodAttachments = task.method_attachments || [];
  
  // Set initial active method
  useEffect(() => {
    if (methodAttachments.length > 0 && !activeMethodId) {
      setActiveMethodId(methodAttachments[0].method_id);
    }
  }, [methodAttachments, activeMethodId]);
  
  // Load all available methods
  const { data: allMethods = [] } = useQuery({
    queryKey: ["methods"],
    queryFn: fetchAllMethodsIncludingShared,
  });
  
  // Get the active method attachment
  const activeAttachment = methodAttachments.find(a => a.method_id === activeMethodId);
  const activeMethod = allMethods.find(m => m.id === activeMethodId);
  
  // Check if active method is a PCR method or PDF method
  const isPcrMethod = activeMethod?.method_type === "pcr" || (activeMethod?.source_path?.startsWith("pcr://") ?? false);
  const isPdfMethod = activeMethod?.method_type === "pdf" || (activeMethod?.source_path?.toLowerCase().endsWith(".pdf") ?? false);
  const pcrProtocolId = activeMethod?.source_path ? extractPCRProtocolId(activeMethod.source_path) : null;
  
  // Load PCR protocol data if this is a PCR method
  const { data: fetchedPcrProtocol } = useQuery({
    queryKey: ["pcr-protocol", pcrProtocolId],
    queryFn: () => pcrApi.get(pcrProtocolId!),
    enabled: isPcrMethod && pcrProtocolId !== null,
  });
  
  // PCR state for the active attachment
  const [pcrGradient, setPcrGradient] = useState<PCRGradient | null>(null);
  const [pcrIngredients, setPcrIngredients] = useState<PCRIngredient[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // Initialize PCR state from attachment
  useEffect(() => {
    if (activeAttachment) {
      if (activeAttachment.pcr_gradient) {
        try {
          setPcrGradient(JSON.parse(activeAttachment.pcr_gradient));
        } catch {
          setPcrGradient(null);
        }
      } else {
        setPcrGradient(null);
      }
      if (activeAttachment.pcr_ingredients) {
        try {
          const parsed = JSON.parse(activeAttachment.pcr_ingredients);
          setPcrIngredients(Array.isArray(parsed) ? parsed : []);
        } catch {
          setPcrIngredients([]);
        }
      } else {
        setPcrIngredients([]);
      }
      setHasUnsavedChanges(false);
    } else if (fetchedPcrProtocol) {
      // Fall back to protocol data if no attachment data
      setPcrGradient(fetchedPcrProtocol.gradient ?? null);
      setPcrIngredients(
        Array.isArray(fetchedPcrProtocol.ingredients) ? fetchedPcrProtocol.ingredients : []
      );
      setHasUnsavedChanges(false);
    }
  }, [activeAttachment, fetchedPcrProtocol]);
  
  // Method content for non-PCR methods
  const [methodContent, setMethodContent] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Load method content from disk for non-PCR methods
  useEffect(() => {
    if (!activeMethod?.source_path || isPcrMethod) {
      setLoading(false);
      setPdfUrl(null);
      return;
    }
    
    setLoading(true);
    
    // Handle PDF methods differently
    if (isPdfMethod) {
      filesApi
        .readFile(activeMethod.source_path)
        .then((file) => {
          // The content comes back as base64 for binary files
          try {
            const binary = atob(file.content);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: "application/pdf" });
            setPdfUrl(URL.createObjectURL(blob));
          } catch {
            setPdfUrl(null);
          }
          setLoading(false);
        })
        .catch(() => {
          setPdfUrl(null);
          setLoading(false);
        });
      
      // Cleanup function to revoke blob URL
      return () => {
        if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      };
    } else {
      // Markdown methods — migrate legacy image refs on load, mirroring the
      // pattern used in TaskDetailPopup and MarkdownMethodViewer. In readOnly
      // mode (lab view), skip the migration save-back; just display the raw
      // content. The actual file rewrite happens the next time an owner
      // opens the method directly.
      let cancelled = false;
      const sourcePath = activeMethod.source_path;
      (async () => {
        try {
          const file = await filesApi.readFile(sourcePath);
          const raw = file.content;
          if (readOnly) {
            if (!cancelled) {
              setMethodContent(raw);
              setLoading(false);
            }
            return;
          }
          const dir = sourcePath.substring(0, sourcePath.lastIndexOf("/"));
          const slug = dir.split("/").pop() || dir;
          const legacyOwner = activeMethod.owner || activeMethod.created_by || undefined;
          const { content: migrated, didMigrate } = await migrateNoteImages(raw, slug, dir, legacyOwner);
          if (didMigrate) {
            await filesApi.writeFile(sourcePath, migrated, `Migrate image references for: ${activeMethod.name}`);
          }
          if (!cancelled) {
            setMethodContent(migrated);
            setLoading(false);
          }
        } catch {
          if (!cancelled) {
            setMethodContent("*Method file not found.*");
            setLoading(false);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [activeMethod?.source_path, isPcrMethod, isPdfMethod, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Track PCR changes
  const originalPcrGradient = useMemo(() => {
    if (activeAttachment?.pcr_gradient) {
      try {
        return JSON.parse(activeAttachment.pcr_gradient);
      } catch {
        return null;
      }
    }
    return null;
  }, [activeAttachment?.pcr_gradient]);
  
  const originalPcrIngredients = useMemo(() => {
    if (activeAttachment?.pcr_ingredients) {
      try {
        return JSON.parse(activeAttachment.pcr_ingredients);
      } catch {
        return [];
      }
    }
    return [];
  }, [activeAttachment?.pcr_ingredients]);
  
  useEffect(() => {
    if (isPcrMethod && pcrGradient && originalPcrGradient) {
      setHasUnsavedChanges(
        JSON.stringify(pcrGradient) !== JSON.stringify(originalPcrGradient) ||
        JSON.stringify(pcrIngredients) !== JSON.stringify(originalPcrIngredients)
      );
    }
  }, [isPcrMethod, pcrGradient, pcrIngredients, originalPcrGradient, originalPcrIngredients]);
  
  // Add method to task
  const handleAddMethod = useCallback(async (methodId: number) => {
    setSaving(true);
    try {
      const updatedTask = await tasksApi.addMethod(task.id, methodId);
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      setActiveMethodId(methodId);
      setShowMethodSelector(false);
      if (updatedTask) if (updatedTask) onTaskUpdate?.(updatedTask);
    } catch (err) {
      console.error("Failed to add method:", err);
      alert("Failed to add method");
    } finally {
      setSaving(false);
    }
  }, [task.id, queryClient, onTaskUpdate]);
  
  // Remove method from task
  const handleRemoveMethod = useCallback(async (methodId: number) => {
    if (!confirm("Remove this method from the experiment?")) return;
    
    setSaving(true);
    try {
      const updatedTask = await tasksApi.removeMethod(task.id, methodId);
      if (!updatedTask) return;
      
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      
      // Switch to another method if the removed one was active
      if (activeMethodId === methodId) {
        const remainingMethods = (updatedTask.method_attachments || []).filter(a => a.method_id !== methodId);
        setActiveMethodId(remainingMethods.length > 0 ? remainingMethods[0].method_id : null);
      }
      
      if (updatedTask) onTaskUpdate?.(updatedTask);
    } catch (err) {
      console.error("Failed to remove method:", err);
      alert("Failed to remove method");
    } finally {
      setSaving(false);
    }
  }, [task.id, activeMethodId, queryClient, onTaskUpdate]);
  
  // Save PCR changes
  const handleSavePcrChanges = useCallback(async () => {
    if (!activeMethodId || !pcrGradient || !pcrIngredients) return;
    
    setSaving(true);
    try {
      const updatedTask = await tasksApi.updateMethodPcr(task.id, activeMethodId, {
        pcr_gradient: JSON.stringify(pcrGradient),
        pcr_ingredients: JSON.stringify(pcrIngredients),
      });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      setHasUnsavedChanges(false);
      if (updatedTask) if (updatedTask) onTaskUpdate?.(updatedTask);
    } catch (err) {
      console.error("Failed to save PCR changes:", err);
      alert("Failed to save PCR changes");
    } finally {
      setSaving(false);
    }
  }, [task.id, activeMethodId, pcrGradient, pcrIngredients, queryClient, onTaskUpdate]);
  
  // Reset PCR to original
  const handleResetPcr = useCallback(async () => {
    if (!activeMethodId) return;
    if (!confirm("Reset PCR data to match the original method? Your changes will be lost.")) return;
    
    setSaving(true);
    try {
      const updatedTask = await tasksApi.resetPcr(task.id, activeMethodId);
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      if (updatedTask) onTaskUpdate?.(updatedTask);
    } catch (err) {
      console.error("Failed to reset PCR:", err);
      alert("Failed to reset PCR data");
    } finally {
      setSaving(false);
    }
  }, [task.id, activeMethodId, queryClient, onTaskUpdate]);
  
  return (
    <div className="flex flex-col h-full">
      {/* Tab bar - browser-like */}
      <div className="flex items-center bg-gray-100 border-b border-gray-200 px-2 pt-2">
        {/* Method tabs */}
        <div className="flex items-end gap-0.5 flex-1 overflow-x-auto">
          {methodAttachments.map((attachment) => {
            const method = allMethods.find(m => m.id === attachment.method_id);
            const isActive = activeMethodId === attachment.method_id;
            
            return (
              <div
                key={attachment.method_id}
                className={`group relative flex items-center gap-1 px-3 py-2 rounded-t-lg text-sm font-medium cursor-pointer transition-colors min-w-[120px] max-w-[200px] ${
                  isActive
                    ? "bg-white text-gray-900 shadow-sm border-t border-l border-r border-gray-200"
                    : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                }`}
                onClick={() => setActiveMethodId(attachment.method_id)}
              >
                {/* Tab icon based on method type */}
                {method?.method_type === "pcr" ? (
                  <span className="text-xs">🧬</span>
                ) : method?.method_type === "pdf" ? (
                  <span className="text-xs">📕</span>
                ) : (
                  <span className="text-xs">📄</span>
                )}
                
                {/* Tab title */}
                <span className="truncate flex-1">
                  {method?.name || `Method ${attachment.method_id}`}
                </span>
                
                {/* Close button - hidden in readOnly mode */}
                {!readOnly && (
                  <Tooltip label="Remove method" placement="bottom">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveMethod(attachment.method_id);
                      }}
                      disabled={saving}
                      className="opacity-0 group-hover:opacity-100 hover:bg-gray-300 rounded p-0.5 transition-opacity"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </Tooltip>
                )}
              </div>
            );
          })}

          {/* Add method button - hidden in readOnly mode */}
          {!readOnly && (
            <Tooltip label="Add method" placement="bottom">
              <button
                onClick={() => setShowMethodSelector(true)}
                className="flex items-center justify-center px-3 py-2 rounded-t-lg text-sm text-gray-500 hover:bg-gray-200 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      
      {/* Method picker modal */}
      <MethodPicker
        open={showMethodSelector}
        currentMethodId={null}
        currentProjectId={task.project_id}
        excludeMethodIds={methodAttachments.map((a) => a.method_id)}
        onSelect={(id) => {
          void handleAddMethod(id);
        }}
        onClose={() => setShowMethodSelector(false)}
      />
      
      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeMethodId === null ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
            <p className="mt-2 text-sm">No methods attached</p>
            <p className="mt-1 text-xs text-gray-300">Click the + button above to add a method</p>
          </div>
        ) : loading ? (
          <div className="p-6 text-sm text-gray-400 animate-pulse">Loading method...</div>
        ) : isPdfMethod ? (
          <div className="flex-1 flex flex-col h-full">
            {/* Variation Notes Panel */}
            <VariationNotesPanel
              taskId={task.id}
              methodId={activeMethodId!}
              variationNotes={activeAttachment?.variation_notes || null}
              onSaved={() => {
                queryClient.refetchQueries({ queryKey: ["task", task.id] });
                queryClient.refetchQueries({ queryKey: ["tasks"] });
              }}
              readOnly={readOnly}
            />
            {pdfUrl ? (
              <iframe 
                src={pdfUrl} 
                className="w-full h-full min-h-[500px] flex-1" 
                title={activeMethod?.name || "PDF Method"} 
              />
            ) : (
              <div className="p-6 text-center">
                <p className="text-sm text-gray-500">Unable to display PDF. The file may not exist yet.</p>
              </div>
            )}
          </div>
        ) : isPcrMethod ? (
          <div className="flex flex-col h-full">
            {/* Variation Notes Panel */}
            <VariationNotesPanel
              taskId={task.id}
              methodId={activeMethodId!}
              variationNotes={activeAttachment?.variation_notes || null}
              onSaved={() => {
                queryClient.refetchQueries({ queryKey: ["task", task.id] });
                queryClient.refetchQueries({ queryKey: ["tasks"] });
              }}
              readOnly={readOnly}
            />
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* PCR header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">{activeMethod?.name || "PCR Protocol"}</span>
                  <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded">PCR</span>
                </div>
                {/* Save/Reset buttons - hidden in readOnly mode */}
                {!readOnly && (
                  <div className="flex items-center gap-2">
                    {hasUnsavedChanges && (
                      <span className="text-xs text-amber-600">Unsaved changes</span>
                    )}
                    <button
                      onClick={handleResetPcr}
                      disabled={saving}
                      className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                      title="Reset to original method values"
                    >
                      Reset to Method
                    </button>
                    <button
                      onClick={handleSavePcrChanges}
                      disabled={saving || !hasUnsavedChanges}
                      className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                )}
              </div>
              
              {/* Gradient Visualization */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">
                  Thermal Gradient
                </label>
                {pcrGradient ? (
                  <InteractiveGradientEditor 
                    gradient={pcrGradient} 
                    onChange={(g) => {
                      setPcrGradient(g);
                    }} 
                  />
                ) : (
                  <p className="text-sm text-gray-400">No gradient data available</p>
                )}
              </div>
              
              {/* Recipe Table */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">
                  Reaction Recipe
                </label>
                <PCRRecipeTable
                  ingredients={pcrIngredients}
                  onChange={(ing) => {
                    setPcrIngredients(ing);
                  }}
                  editable={!readOnly}
                />
              </div>
              
              {/* Notes */}
              {fetchedPcrProtocol?.notes && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">
                    {fetchedPcrProtocol.notes}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Variation Notes Panel */}
            <VariationNotesPanel
              taskId={task.id}
              methodId={activeMethodId!}
              variationNotes={activeAttachment?.variation_notes || null}
              onSaved={() => {
                queryClient.refetchQueries({ queryKey: ["task", task.id] });
                queryClient.refetchQueries({ queryKey: ["tasks"] });
              }}
              readOnly={readOnly}
            />
            <div className="flex-1 overflow-y-auto p-6 prose prose-sm prose-gray max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {methodContent}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Variation Notes Panel Component ───────────────────────────────────────────────

interface VariationEntry {
  heading: string;
  body: string;
}

/**
 * Split a variation-notes markdown blob into individual entries, each headed
 * by a `### Variation ...` line. Handles both legacy ("Variation (timestamp)")
 * and current ("Variation - timestamp") header formats. Any text before the
 * first header is returned as a leading entry with an empty heading so it
 * isn't silently dropped.
 */
function parseVariationEntries(markdown: string): VariationEntry[] {
  if (!markdown.trim()) return [];
  const headerRegex = /^###\s+Variation\b[^\n]*$/gm;
  const matches: Array<{ text: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(markdown)) !== null) {
    matches.push({ text: m[0], start: m.index });
  }
  if (matches.length === 0) {
    return [{ heading: "", body: markdown.trim() }];
  }
  const entries: VariationEntry[] = [];
  // Anything before the first header — preserve as a heading-less entry.
  const prologue = markdown.substring(0, matches[0].start).trim();
  if (prologue) entries.push({ heading: "", body: prologue });
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start;
    const end = i + 1 < matches.length ? matches[i + 1].start : markdown.length;
    const heading = matches[i].text;
    const body = markdown.substring(start + heading.length, end).replace(/^\n+/, "").replace(/\s+$/, "");
    entries.push({ heading, body });
  }
  return entries;
}

/**
 * Remove the `entryIndex`-th `### Variation` entry from the markdown.
 * Indices match `parseVariationEntries` output (a leading heading-less entry,
 * if present, counts as index 0 and is not deletable via this helper — the
 * caller should hide the trash button for that case).
 */
function removeVariationEntry(markdown: string, entryIndex: number): string {
  const headerRegex = /^###\s+Variation\b[^\n]*$/gm;
  const matches: Array<{ start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(markdown)) !== null) {
    matches.push({ start: m.index });
  }
  // Account for a leading heading-less prologue offsetting indices by 1.
  const prologue = matches.length > 0 ? markdown.substring(0, matches[0].start).trim() : "";
  const headerArrayIndex = prologue ? entryIndex - 1 : entryIndex;
  if (headerArrayIndex < 0 || headerArrayIndex >= matches.length) return markdown;
  const start = matches[headerArrayIndex].start;
  const end =
    headerArrayIndex + 1 < matches.length
      ? matches[headerArrayIndex + 1].start
      : markdown.length;
  return (markdown.substring(0, start) + markdown.substring(end)).trim();
}

interface VariationNotesPanelProps {
  taskId: number;
  methodId: number;
  variationNotes: string | null;
  onSaved: () => void;
  readOnly?: boolean; // When true, all editing is disabled (for lab mode)
}

function VariationNotesPanel({ taskId, methodId, variationNotes, onSaved, readOnly = false }: VariationNotesPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(variationNotes || "");
  const [originalContent, setOriginalContent] = useState(variationNotes || "");
  const [saving, setSaving] = useState(false);

  // Variation notes are stored inline in the Task JSON, not in a Files/
  // folder — so dropping a file here has nowhere to go. Flash a toast.
  const { show: showDropWarning, toast: dropWarningToast } = useDropWarning(
    "File attachments aren't supported on variation notes. Attach files via the method's main page or a task's Lab Notes / Results tab."
  );
  
  // Track unsaved changes
  const hasUnsavedChanges = content !== originalContent;
  
  // Count the number of variation entries (### headers)
  const noteCount = useMemo(() => {
    if (!variationNotes) return 0;
    const matches = variationNotes.match(/^###\s+Variation/gm);
    return matches ? matches.length : 0;
  }, [variationNotes]);
  
  // Reset content when notes change externally
  useEffect(() => {
    setContent(variationNotes || "");
    setOriginalContent(variationNotes || "");
  }, [variationNotes]);
  
  // Generate a new timestamped entry
  const generateTimestamp = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { 
      year: "numeric", 
      month: "long", 
      day: "numeric" 
    });
    const timeStr = now.toLocaleTimeString("en-US", { 
      hour: "numeric", 
      minute: "2-digit",
      hour12: true 
    });
    return `${dateStr} ${timeStr}`;
  };
  
  // Add a new note entry
  const handleAddNote = useCallback(() => {
    const timestamp = generateTimestamp();
    const newEntry = `### Variation - ${timestamp}\n\n`;
    setContent(prev => newEntry + prev);
    setIsEditing(true);
  }, []);
  
  // Save the notes
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await tasksApi.saveVariationNote(taskId, methodId, content);
      setOriginalContent(content); // Update original content after successful save
      onSaved();
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to save variation notes:", err);
      alert("Failed to save variation notes");
    } finally {
      setSaving(false);
    }
  }, [taskId, methodId, content, onSaved]);
  
  // Cancel editing
  const handleCancel = useCallback(() => {
    setContent(variationNotes || "");
    setOriginalContent(variationNotes || "");
    setIsEditing(false);
  }, [variationNotes]);

  // Delete a single variation entry (in-place; no Edit All needed)
  const handleDeleteEntry = useCallback(
    async (entryIndex: number) => {
      if (!variationNotes) return;
      if (!window.confirm("Delete this variation note? This can't be undone.")) return;
      const updated = removeVariationEntry(variationNotes, entryIndex);
      setSaving(true);
      try {
        await tasksApi.saveVariationNote(taskId, methodId, updated);
        onSaved();
      } catch (err) {
        console.error("Failed to delete variation note:", err);
        alert("Failed to delete variation note");
      } finally {
        setSaving(false);
      }
    },
    [variationNotes, taskId, methodId, onSaved],
  );

  // Split rendered notes into individual entries so each gets its own delete button.
  const entries = useMemo(() => parseVariationEntries(variationNotes || ""), [variationNotes]);
  
  return (
    <div className="border-b border-gray-200">
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-amber-50 hover:bg-amber-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">📝</span>
          <span className="text-sm font-medium text-amber-800">Variation Notes</span>
          {noteCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 bg-amber-200 text-amber-700 rounded">
              {noteCount} {noteCount === 1 ? "entry" : "entries"}
            </span>
          )}
          {!variationNotes && (
            <span className="text-xs text-amber-600 italic">Click to add notes</span>
          )}
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-amber-600 transition-transform ${isExpanded ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      
      {/* Expanded content */}
      {isExpanded && (
        <div className="bg-amber-50/50 p-4">
          {isEditing ? (
            <div className="space-y-3">
              <LiveMarkdownEditor
                value={content}
                onChange={setContent}
                placeholder="Write your variation notes in markdown..."
                showToolbar={true}
                allowAnyFileType={true}
                onFileDrop={showDropWarning}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
                >
                  Cancel
                </button>
                {hasUnsavedChanges && (
                  <span className="text-xs text-amber-600 font-medium flex items-center">Unsaved changes</span>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges}
                  className={`px-3 py-1.5 text-xs rounded-lg disabled:opacity-50 ${
                    hasUnsavedChanges
                      ? "text-white bg-amber-600 hover:bg-amber-700"
                      : "text-gray-400 bg-gray-200 cursor-not-allowed"
                  }`}
                >
                  {saving ? "Saving..." : "Save Notes"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {variationNotes && entries.length > 0 ? (
                <div className="space-y-2">
                  {entries.map((entry, idx) => {
                    // Heading-less leading prologue (legacy data) — no delete button.
                    const canDelete = !readOnly && entry.heading !== "";
                    return (
                      <div
                        key={idx}
                        className="group relative bg-white rounded-lg p-4 pr-9 border border-amber-200"
                      >
                        {canDelete && (
                          <Tooltip label="Delete this variation" placement="left">
                            <button
                              type="button"
                              onClick={() => handleDeleteEntry(idx)}
                              disabled={saving}
                              className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
                              aria-label="Delete this variation"
                            >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            </button>
                          </Tooltip>
                        )}
                        <div className="prose prose-sm prose-amber max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                            {entry.heading ? `${entry.heading}\n\n${entry.body}` : entry.body}
                          </ReactMarkdown>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-6 text-amber-600">
                  <p className="text-sm">No variation notes yet.</p>
                  <p className="text-xs mt-1">Document any changes you make to the method during this experiment.</p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                {!readOnly && (
                  <button
                    onClick={handleAddNote}
                    className="px-3 py-1.5 text-xs text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg"
                  >
                    + Add Note
                  </button>
                )}
                {variationNotes && !readOnly && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    Edit All
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {dropWarningToast}
    </div>
  );
}

// ── PCR Recipe Table Component ───────────────────────────────────────────────

function PCRRecipeTable({
  ingredients,
  onChange,
  editable,
}: {
  ingredients: PCRIngredient[];
  onChange?: (ingredients: PCRIngredient[]) => void;
  editable: boolean;
}) {
  const handleChange = (id: string, field: keyof PCRIngredient, value: string | boolean) => {
    if (!onChange) return;
    onChange(
      ingredients.map((ing) =>
        ing.id === id ? { ...ing, [field]: value } : ing
      )
    );
  };

  const toggleChecked = (id: string) => {
    if (!onChange) return;
    onChange(
      ingredients.map((ing) =>
        ing.id === id ? { ...ing, checked: !ing.checked } : ing
      )
    );
  };

  const addRow = () => {
    if (!onChange) return;
    const newId = String(Date.now());
    // Insert before Total row if it exists
    const totalIndex = ingredients.findIndex((ing) => ing.name === "Total");
    if (totalIndex >= 0) {
      const newIngredients = [
        ...ingredients.slice(0, totalIndex),
        { id: newId, name: "", concentration: "", amount_per_reaction: "", checked: false },
        ...ingredients.slice(totalIndex),
      ];
      onChange(newIngredients);
    } else {
      onChange([
        ...ingredients,
        { id: newId, name: "", concentration: "", amount_per_reaction: "", checked: false },
      ]);
    }
  };

  const removeRow = (id: string) => {
    if (!onChange) return;
    // Don't remove if it's the Total row
    const ing = ingredients.find((i) => i.id === id);
    if (ing?.name === "Total") return;
    onChange(ingredients.filter((i) => i.id !== id));
  };

  // Count checked items (excluding Total row)
  const checkedCount = ingredients.filter(ing => ing.name !== "Total" && ing.checked).length;
  const totalCount = ingredients.filter(ing => ing.name !== "Total").length;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Progress indicator */}
      {totalCount > 0 && (
        <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${(checkedCount / totalCount) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 flex-shrink-0">
            {checkedCount}/{totalCount} checked
          </span>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-2 py-2 w-10 text-center text-xs font-medium text-gray-500" title="Check off ingredients as you add them">✓</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Ingredient</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Concentration</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Amount (uL)</th>
            {editable && <th className="px-3 py-2 w-10"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ingredients.map((ing) => (
            <tr 
              key={ing.id} 
              className={`${ing.name === "Total" ? "bg-gray-50 font-medium" : ""} ${ing.checked && ing.name !== "Total" ? "bg-green-50" : ""} transition-colors`}
            >
              <td className="px-2 py-2 text-center">
                {ing.name !== "Total" && (
                  <Tooltip label={ing.checked ? "Mark as not added" : "Mark as added"} placement="bottom">
                    <button
                      onClick={() => toggleChecked(ing.id)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                        ing.checked
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-gray-300 hover:border-green-400 hover:bg-green-50"
                      }`}
                    >
                      {ing.checked && (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  </Tooltip>
                )}
              </td>
              <td className="px-3 py-2">
                {editable && ing.name !== "Total" ? (
                  <input
                    type="text"
                    value={ing.name}
                    onChange={(e) => handleChange(ing.id, "name", e.target.value)}
                    className={`w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${ing.checked ? "line-through text-gray-400" : ""}`}
                  />
                ) : (
                  <span className={`text-gray-900 ${ing.checked ? "line-through text-gray-400" : ""}`}>{ing.name}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {editable && ing.name !== "Total" ? (
                  <input
                    type="text"
                    value={ing.concentration}
                    onChange={(e) => handleChange(ing.id, "concentration", e.target.value)}
                    className={`w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${ing.checked ? "line-through text-gray-400" : ""}`}
                    placeholder="e.g. 10x"
                  />
                ) : (
                  <span className={`text-gray-600 ${ing.checked ? "line-through text-gray-400" : ""}`}>{ing.concentration || "-"}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {editable ? (
                  <input
                    type="text"
                    value={ing.amount_per_reaction}
                    onChange={(e) => handleChange(ing.id, "amount_per_reaction", e.target.value)}
                    className={`w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${ing.checked ? "line-through text-gray-400" : ""}`}
                    placeholder="e.g. 2.5"
                  />
                ) : (
                  <span className={`text-gray-600 ${ing.checked ? "line-through text-gray-400" : ""}`}>{ing.amount_per_reaction || "-"}</span>
                )}
              </td>
              {editable && ing.name !== "Total" && (
                <td className="px-3 py-2">
                  <Tooltip label="Remove ingredient" placement="left">
                    <button
                      onClick={() => removeRow(ing.id)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      x
                    </button>
                  </Tooltip>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <button
          onClick={addRow}
          className="w-full py-2 text-xs text-blue-600 hover:bg-blue-50 border-t border-gray-200"
        >
          + Add Row
        </button>
      )}
    </div>
  );
}
