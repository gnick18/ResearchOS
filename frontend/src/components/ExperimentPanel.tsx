"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { githubApi, methodsApi, tasksApi, pcrApi, projectsApi, attachmentsApi, type ImageUploadResponse } from "@/lib/api";
import type { GitHubTreeItem } from "@/lib/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InteractiveGradientEditor } from "@/components/InteractiveGradientEditor";
import LiveMarkdownEditor from "@/components/LiveMarkdownEditor";
import ImageGalleryPopup from "@/components/ImageGalleryPopup";
import type { Method, Task, PCRProtocol, PCRGradient, PCRIngredient } from "@/lib/types";
import {
  createNewFileContent,
  parseStamp,
  shouldAddReopenedStamp,
  updateLastAccess,
  addReopenedStamp,
  updateStampNames,
  renderStampDisplay,
  type StampData,
} from "@/lib/stamp-utils";
import {
  exportSingleExperiment,
  hasUserContent,
  type ExportOptions,
  type ExperimentExportData,
} from "@/lib/export-utils";
import { useFileRenamePopup } from "@/components/FileRenamePopup";

// ── PDF Attachment Types ───────────────────────────────────────────────────────

interface PdfAttachment {
  name: string;
  path: string;
  url: string | null;
  loading: boolean;
  isRenderable: boolean; // PDFs and images can be rendered in browser
}

interface ExperimentPanelProps {
  task: Task;
  onClose: () => void;
}

type Tab = "notes" | "method" | "results";

export default function ExperimentPanel({ task, onClose }: ExperimentPanelProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("notes");
  const [currentTask, setCurrentTask] = useState(task);

  // Refresh task data
  const { data: freshTask } = useQuery({
    queryKey: ["task", task.id],
    queryFn: () => tasksApi.get(task.id),
    initialData: task,
  });

  useEffect(() => {
    if (freshTask) setCurrentTask(freshTask);
  }, [freshTask]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🧪</span>
              <h3 className="text-base font-semibold text-gray-900">
                {currentTask.name}
              </h3>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {currentTask.start_date} · {currentTask.duration_days} day
              {currentTask.duration_days !== 1 ? "s" : ""}
              {currentTask.is_complete && " · Complete"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Export button */}
            <ExportButton task={currentTask} />
            {/* Completion toggle */}
            <button
              onClick={async () => {
                try {
                  await tasksApi.update(currentTask.id, { is_complete: !currentTask.is_complete });
                  await queryClient.refetchQueries({ queryKey: ["tasks"] });
                  await queryClient.refetchQueries({ queryKey: ["task", currentTask.id] });
                } catch {
                  alert("Failed to update task");
                }
              }}
              className={`p-1.5 rounded-full transition-all ${
                currentTask.is_complete 
                  ? "bg-green-500 text-white hover:bg-green-600" 
                  : "text-gray-300 hover:text-green-500 hover:bg-green-50"
              }`}
              title={currentTask.is_complete ? "Mark as incomplete" : "Mark as complete"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6">
          {(["notes", "method", "results"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              {tab === "notes" && "📝 Lab Notes"}
              {tab === "method" && "📋 Method"}
              {tab === "results" && "📊 Results"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "notes" && <LabNotesTab task={currentTask} />}
          {activeTab === "method" && <MethodTab task={currentTask} />}
          {activeTab === "results" && <ResultsTab task={currentTask} />}
        </div>
      </div>
    </div>
  );
}

// ── Lab Notes Tab ────────────────────────────────────────────────────────────

type ContentSubTab = "markdown" | "pdfs";

function LabNotesTab({ task }: { task: Task }) {
  const [activeSubTab, setActiveSubTab] = useState<ContentSubTab>("markdown");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [stamp, setStamp] = useState<StampData | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [showImageGallery, setShowImageGallery] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();

  const notesPath = `results/task-${task.id}/notes.md`;
  const imagesDir = `results/task-${task.id}/Images`;
  const pdfsDir = `results/task-${task.id}/NotesPDFs`;

  // Fetch project name
  const { data: project } = useQuery({
    queryKey: ["project", task.project_id],
    queryFn: () => projectsApi.get(task.project_id),
  });

  const projectName = project?.name || "Unknown Project";

  // Track if there are unsaved changes
  const hasUnsavedChanges = content !== originalContent && !loading;

  useEffect(() => {
    githubApi
      .readFile(notesPath)
      .then((file) => {
        let fileContent = file.content;
        
        // Parse stamp from content
        const parsedStamp = parseStamp(fileContent);
        setStamp(parsedStamp);

        // Check if we need to add reopened stamp
        if (shouldAddReopenedStamp(fileContent)) {
          fileContent = addReopenedStamp(fileContent);
          fileContent = updateLastAccess(fileContent);
          // Save the updated content with reopened stamp
          githubApi.writeFile(
            notesPath,
            fileContent,
            `Add reopened stamp for: ${task.name}`
          ).catch(console.error);
        }

        // Update stamp names in case experiment/project was renamed
        if (parsedStamp) {
          fileContent = updateStampNames(fileContent, task.name, projectName);
        }

        setContent(fileContent);
        setOriginalContent(fileContent);
        setLoading(false);
      })
      .catch(() => {
        // File doesn't exist - create new content with stamp
        const newContent = createNewFileContent(task.name, projectName, 'notes');
        setContent(newContent);
        setOriginalContent(newContent);
        setStamp({
          date: new Date().toLocaleDateString('en-CA'),
          time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
          experimentName: task.name,
          projectFolder: projectName,
        });
        setLoading(false);
      });
  }, [notesPath, task.name, projectName]);

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Fetch file count for badge
  useEffect(() => {
    const fetchFileCount = async () => {
      try {
        const dirFiles = await githubApi.listDirectory(pdfsDir);
        setFileCount(dirFiles.length);
      } catch {
        setFileCount(0);
      }
    };
    fetchFileCount();
  }, [pdfsDir]);

  // Handle image upload for LiveMarkdownEditor (from drag-drop, paste, or file picker)
  const handleImageUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        
        // Show rename popup and wait for user decision
        const renamedFile = await requestRename(file);
        if (!renamedFile) {
          continue; // User cancelled
        }
        
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];

          try {
            // Use new attachments API
            const response = await attachmentsApi.uploadImage({
              experiment_id: task.id,
              experiment_name: task.name,
              project_id: task.project_id,
              project_name: projectName,
              experiment_date: task.start_date,
              base64_content: base64,
              original_filename: renamedFile.name,
            });
            
            // Insert relative link with new path structure
            const imageMarkdown = `\n![${renamedFile.name}](../../Images/${response.folder}/${response.filename})\n`;
            setContent((prev) => prev + imageMarkdown);
            
            // Show warning if file is too large for GitHub
            if (response.warning) {
              setUploadWarning(response.warning);
            }
          } catch {
            alert(`Failed to upload ${renamedFile.name}`);
          }
        };
        reader.readAsDataURL(renamedFile);
      }
      setUploading(false);
    },
    [task.id, task.name, task.project_id, task.start_date, projectName, requestRename]
  );

  // Handle file upload (saves to attachments folder, does NOT embed in markdown)
  const handleFileUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      
      for (const file of files) {
        // Show rename popup and wait for user decision
        const renamedFile = await requestRename(file);
        if (!renamedFile) {
          continue; // User cancelled
        }
        
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];

          try {
            // Use new attachments API
            const response = await attachmentsApi.uploadFile({
              experiment_id: task.id,
              experiment_name: task.name,
              project_id: task.project_id,
              project_name: projectName,
              experiment_date: task.start_date,
              attachment_type: "notes",
              base64_content: base64,
              original_filename: renamedFile.name,
            });
            
            // Show warning if file is too large for GitHub
            if (response.warning) {
              setUploadWarning(response.warning);
            }
            
            // Refresh file count
            const files = await attachmentsApi.listFiles({ experiment_id: task.id, attachment_type: "notes" });
            setFileCount(files.length);
          } catch {
            alert(`Failed to upload ${renamedFile.name}`);
          }
        };
        reader.readAsDataURL(renamedFile);
      }
      setUploading(false);
    },
    [task.id, task.name, task.project_id, task.start_date, projectName, requestRename]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Update stamp names before saving (in case experiment/project was renamed)
      let contentToSave = updateStampNames(content, task.name, projectName);
      contentToSave = updateLastAccess(contentToSave);
      
      await githubApi.writeFile(
        notesPath,
        contentToSave,
        `Update lab notes for: ${task.name}`
      );
      setContent(contentToSave);
      setOriginalContent(contentToSave); // Update original content after successful save
    } catch {
      alert("Failed to save notes");
    } finally {
      setSaving(false);
    }
  }, [content, notesPath, task.name, projectName]);

  // Handle inserting image from gallery
  const handleInsertImageFromGallery = useCallback(
    (markdownPath: string, imageName: string) => {
      const imageMarkdown = `\n![${imageName}](${markdownPath})\n`;
      setContent((prev) => prev + imageMarkdown);
    },
    []
  );

  // Render stamp display with current names
  const stampDisplay = stamp ? renderStampDisplay(stamp, task.name, projectName, 'notes') : null;

  return (
    <>
      <FileRenamePopup />
      <div className="flex flex-col h-full">
      {/* Sub-tabs for Markdown and PDFs */}
      <div className="flex items-center gap-1 px-6 py-2 bg-gray-50 border-b border-gray-100">
        <button
          onClick={() => setActiveSubTab("markdown")}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeSubTab === "markdown"
              ? "bg-white text-blue-600 shadow-sm border border-gray-200"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          }`}
        >
          📝 Markdown
        </button>
        <button
          onClick={() => setActiveSubTab("pdfs")}
          className={`relative px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeSubTab === "pdfs"
              ? "bg-white text-blue-600 shadow-sm border border-gray-200"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          }`}
        >
          📎 Files
          {fileCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full">
              {fileCount > 99 ? "99+" : fileCount}
            </span>
          )}
        </button>
      </div>

      {activeSubTab === "markdown" ? (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {uploading ? "Uploading..." : "📎 Add File"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFileUpload(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
            <div className="flex-1" />
            {hasUnsavedChanges && (
              <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !hasUnsavedChanges}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                hasUnsavedChanges
                  ? "text-white bg-blue-600 hover:bg-blue-700"
                  : "text-gray-400 bg-gray-200 cursor-not-allowed"
              } disabled:opacity-50`}
            >
              {saving ? "Saving..." : "Save Notes"}
            </button>
          </div>

          {/* File size warning */}
          {uploadWarning && (
            <div className="px-6 py-3 bg-amber-50 border-b border-amber-200">
              <div className="flex items-start gap-2">
                <span className="text-amber-500 text-sm">⚠️</span>
                <div className="flex-1">
                  <p className="text-sm text-amber-800">{uploadWarning}</p>
                </div>
                <button
                  onClick={() => setUploadWarning(null)}
                  className="text-amber-400 hover:text-amber-600 text-sm"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Stamp Display (locked) */}
          {stampDisplay && (
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
              <div className="text-xs text-gray-500 font-mono whitespace-pre-line">
                {stampDisplay}
              </div>
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-6 text-sm text-gray-400 animate-pulse">Loading...</p>
            ) : (
              <LiveMarkdownEditor
                value={content}
                onChange={setContent}
                placeholder="Click to start writing lab notes..."
                onImageDrop={handleImageUpload}
                imageBasePath={`results/task-${task.id}`}
                showToolbar={true}
                onBrowseImages={() => setShowImageGallery(true)}
              />
            )}
          </div>
        </>
      ) : (
        <PdfAttachmentsPanel task={task} pdfsDir={pdfsDir} label="Lab Notes" onFilesChange={setFileCount} />
      )}
      
      {/* Image Gallery Popup */}
      <ImageGalleryPopup
        isOpen={showImageGallery}
        onClose={() => setShowImageGallery(false)}
        experimentId={task.id}
        experimentName={task.name}
        experimentDate={task.start_date}
        onInsertImage={handleInsertImageFromGallery}
      />
    </div>
    </>
  );
}

// ── Method Tab ───────────────────────────────────────────────────────────────

function MethodTab({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [methodContent, setMethodContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDeviationChoice, setShowDeviationChoice] = useState(false);
  const [forkName, setForkName] = useState("");

  // Load the linked method
  const { data: method } = useQuery({
    queryKey: ["method", task.method_id],
    queryFn: () => methodsApi.get(task.method_id!),
    enabled: !!task.method_id,
  });

  // Load method content from file
  useEffect(() => {
    if (!method?.github_path) {
      setLoading(false);
      return;
    }
    githubApi
      .readFile(method.github_path)
      .then((file) => {
        setMethodContent(file.content);
        setOriginalContent(file.content);
        setLoading(false);
      })
      .catch(() => {
        setMethodContent("*Method file not found. Create it in the Methods section.*");
        setOriginalContent("");
        setLoading(false);
      });
  }, [method?.github_path]);

  const hasChanges = methodContent !== originalContent && originalContent !== "";

  const handleSaveChoice = useCallback(() => {
    if (!hasChanges) return;
    setShowDeviationChoice(true);
  }, [hasChanges]);

  // Save deviations to task notes only
  const handleSaveToNotes = useCallback(async () => {
    setSaving(true);
    try {
      // Compute a diff description
      const deviations = `## Method Deviations\n\nModified method content (saved to task notes only):\n\n${methodContent}`;
      await methodsApi.saveDeviation({
        task_id: task.id,
        deviations,
      });
      // Revert method content to original
      setMethodContent(originalContent);
      setShowDeviationChoice(false);
      setEditing(false);
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
    } catch {
      alert("Failed to save deviations");
    } finally {
      setSaving(false);
    }
  }, [methodContent, originalContent, task.id, queryClient]);

  // Fork as new method
  const handleForkMethod = useCallback(async () => {
    if (!forkName.trim() || !method) return;
    setSaving(true);
    try {
      const newMethod = await methodsApi.fork(method.id, {
        new_name: forkName.trim(),
        new_github_path: `methods/${forkName.trim().replace(/\s+/g, "-").toLowerCase()}.md`,
        deviations: "Forked with modifications",
      });

      // Write the modified content to the new method file
      if (newMethod.github_path) {
        await githubApi.writeFile(
          newMethod.github_path,
          methodContent,
          `Fork method: ${forkName} from ${method.name}`
        );
      }

      // Update the task to link to the new method
      await tasksApi.update(task.id, { method_id: newMethod.id });

      setShowDeviationChoice(false);
      setEditing(false);
      setForkName("");
      await queryClient.refetchQueries({ queryKey: ["methods"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["method", task.method_id] });
    } catch {
      alert("Failed to fork method");
    } finally {
      setSaving(false);
    }
  }, [forkName, method, methodContent, task.id, task.method_id, queryClient]);

  if (!task.method_id) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-gray-400 mb-2">No method linked to this experiment.</p>
        <p className="text-xs text-gray-300">
          Edit the task to link a method from the Methods library.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50">
        <span className="text-xs text-gray-400">
          {method?.name || "Loading..."}
        </span>
        <div className="flex-1" />
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
          >
            ✏️ Edit Method
          </button>
        ) : (
          <>
            <button
              onClick={() => {
                setMethodContent(originalContent);
                setEditing(false);
              }}
              className="px-3 py-1.5 text-xs text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveChoice}
              disabled={!hasChanges || saving}
              className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              Save Changes
            </button>
          </>
        )}
      </div>

      {/* Deviation choice modal */}
      {showDeviationChoice && (
        <div className="px-6 py-4 bg-amber-50 border-b border-amber-200">
          <p className="text-sm font-medium text-amber-800 mb-3">
            You've modified the method. How would you like to save?
          </p>
          <div className="space-y-2">
            <button
              onClick={handleSaveToNotes}
              disabled={saving}
              className="w-full text-left px-4 py-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <p className="text-sm font-medium text-gray-900">
                Save to this experiment's notes only
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                The original method stays unchanged. Deviations are recorded in
                this task's log.
              </p>
            </button>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-900 mb-2">
                Save as a new method
              </p>
              <p className="text-xs text-gray-400 mb-2">
                Creates a new method with your changes that can be reused in
                future experiments.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={forkName}
                  onChange={(e) => setForkName(e.target.value)}
                  placeholder={`${method?.name} v2`}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleForkMethod}
                  disabled={saving || !forkName.trim()}
                  className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Fork"}
                </button>
              </div>
            </div>
            <button
              onClick={() => setShowDeviationChoice(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-sm text-gray-400 animate-pulse">Loading...</p>
        ) : editing ? (
          <textarea
            value={methodContent}
            onChange={(e) => setMethodContent(e.target.value)}
            className="w-full h-full min-h-[400px] p-6 text-sm font-mono text-gray-700 resize-none focus:outline-none"
          />
        ) : (
          <div className="p-6 prose prose-sm prose-gray max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {methodContent}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Results Tab ──────────────────────────────────────────────────────────────

function ResultsTab({ task }: { task: Task }) {
  const [activeSubTab, setActiveSubTab] = useState<ContentSubTab>("markdown");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [stamp, setStamp] = useState<StampData | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [showImageGallery, setShowImageGallery] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();

  const resultsPath = `results/task-${task.id}/results.md`;
  const imagesDir = `results/task-${task.id}/Images`;
  const pdfsDir = `results/task-${task.id}/ResultsPDFs`;

  // Fetch project name
  const { data: project } = useQuery({
    queryKey: ["project", task.project_id],
    queryFn: () => projectsApi.get(task.project_id),
  });

  const projectName = project?.name || "Unknown Project";

  // Track if there are unsaved changes
  const hasUnsavedChanges = content !== originalContent && !loading;

  useEffect(() => {
    githubApi
      .readFile(resultsPath)
      .then((file) => {
        let fileContent = file.content;
        
        // Parse stamp from content
        const parsedStamp = parseStamp(fileContent);
        setStamp(parsedStamp);

        // Check if we need to add reopened stamp
        if (shouldAddReopenedStamp(fileContent)) {
          fileContent = addReopenedStamp(fileContent);
          fileContent = updateLastAccess(fileContent);
          // Save the updated content with reopened stamp
          githubApi.writeFile(
            resultsPath,
            fileContent,
            `Add reopened stamp for: ${task.name}`
          ).catch(console.error);
        }

        // Update stamp names in case experiment/project was renamed
        if (parsedStamp) {
          fileContent = updateStampNames(fileContent, task.name, projectName);
        }

        setContent(fileContent);
        setOriginalContent(fileContent);
        setLoading(false);
      })
      .catch(() => {
        // File doesn't exist - create new content with stamp
        const newContent = createNewFileContent(task.name, projectName, 'results');
        setContent(newContent);
        setOriginalContent(newContent);
        setStamp({
          date: new Date().toLocaleDateString('en-CA'),
          time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
          experimentName: task.name,
          projectFolder: projectName,
        });
        setLoading(false);
      });
  }, [resultsPath, task.name, projectName]);

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Fetch file count for badge
  useEffect(() => {
    const fetchFileCount = async () => {
      try {
        const dirFiles = await githubApi.listDirectory(pdfsDir);
        setFileCount(dirFiles.length);
      } catch {
        setFileCount(0);
      }
    };
    fetchFileCount();
  }, [pdfsDir]);

  // Handle image upload for LiveMarkdownEditor (from drag-drop, paste, or file picker)
  const handleImageUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        
        // Show rename popup and wait for user decision
        const renamedFile = await requestRename(file);
        if (!renamedFile) {
          continue; // User cancelled
        }
        
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];

          try {
            // Use new attachments API
            const response = await attachmentsApi.uploadImage({
              experiment_id: task.id,
              experiment_name: task.name,
              project_id: task.project_id,
              project_name: projectName,
              experiment_date: task.start_date,
              base64_content: base64,
              original_filename: renamedFile.name,
            });
            
            // Insert relative link with new path structure
            const imageMarkdown = `\n![${renamedFile.name}](../../Images/${response.folder}/${response.filename})\n`;
            setContent((prev) => prev + imageMarkdown);
            
            // Show warning if file is too large for GitHub
            if (response.warning) {
              setUploadWarning(response.warning);
            }
          } catch {
            alert(`Failed to upload ${renamedFile.name}`);
          }
        };
        reader.readAsDataURL(renamedFile);
      }
      setUploading(false);
    },
    [task.id, task.name, task.project_id, task.start_date, projectName, requestRename]
  );

  // Handle file upload (saves to attachments folder, does NOT embed in markdown)
  const handleFileUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      
      for (const file of files) {
        // Show rename popup and wait for user decision
        const renamedFile = await requestRename(file);
        if (!renamedFile) {
          continue; // User cancelled
        }
        
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];

          try {
            // Use new attachments API
            const response = await attachmentsApi.uploadFile({
              experiment_id: task.id,
              experiment_name: task.name,
              project_id: task.project_id,
              project_name: projectName,
              experiment_date: task.start_date,
              attachment_type: "results",
              base64_content: base64,
              original_filename: renamedFile.name,
            });
            
            // Show warning if file is too large for GitHub
            if (response.warning) {
              setUploadWarning(response.warning);
            }
            
            // Refresh file count
            const files = await attachmentsApi.listFiles({ experiment_id: task.id, attachment_type: "results" });
            setFileCount(files.length);
          } catch {
            alert(`Failed to upload ${renamedFile.name}`);
          }
        };
        reader.readAsDataURL(renamedFile);
      }
      setUploading(false);
    },
    [task.id, task.name, task.project_id, task.start_date, projectName, requestRename]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Update stamp names before saving (in case experiment/project was renamed)
      let contentToSave = updateStampNames(content, task.name, projectName);
      contentToSave = updateLastAccess(contentToSave);
      
      await githubApi.writeFile(
        resultsPath,
        contentToSave,
        `Update results for: ${task.name}`
      );
      setContent(contentToSave);
    } catch {
      alert("Failed to save results");
    } finally {
      setSaving(false);
    }
  }, [content, resultsPath, task.name, projectName]);

  // Handle inserting image from gallery
  const handleInsertImageFromGallery = useCallback(
    (markdownPath: string, imageName: string) => {
      const imageMarkdown = `\n![${imageName}](${markdownPath})\n`;
      setContent((prev) => prev + imageMarkdown);
    },
    []
  );

  // Render stamp display with current names
  const stampDisplay = stamp ? renderStampDisplay(stamp, task.name, projectName, 'results') : null;

  return (
    <>
      <FileRenamePopup />
      <div className="flex flex-col h-full">
      {/* Sub-tabs for Markdown and PDFs */}
      <div className="flex items-center gap-1 px-6 py-2 bg-gray-50 border-b border-gray-100">
        <button
          onClick={() => setActiveSubTab("markdown")}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeSubTab === "markdown"
              ? "bg-white text-blue-600 shadow-sm border border-gray-200"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          }`}
        >
          📝 Markdown
        </button>
        <button
          onClick={() => setActiveSubTab("pdfs")}
          className={`relative px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeSubTab === "pdfs"
              ? "bg-white text-blue-600 shadow-sm border border-gray-200"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          }`}
        >
          📎 Files
          {fileCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full">
              {fileCount > 99 ? "99+" : fileCount}
            </span>
          )}
        </button>
      </div>

      {activeSubTab === "markdown" ? (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {uploading ? "Uploading..." : "📎 Add File"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFileUpload(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
            <div className="flex-1" />
            {hasUnsavedChanges && (
              <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !hasUnsavedChanges}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                hasUnsavedChanges
                  ? "text-white bg-blue-600 hover:bg-blue-700"
                  : "text-gray-400 bg-gray-200 cursor-not-allowed"
              } disabled:opacity-50`}
            >
              {saving ? "Saving..." : "Save Results"}
            </button>
          </div>

          {/* File size warning */}
          {uploadWarning && (
            <div className="px-6 py-3 bg-amber-50 border-b border-amber-200">
              <div className="flex items-start gap-2">
                <span className="text-amber-500 text-sm">⚠️</span>
                <div className="flex-1">
                  <p className="text-sm text-amber-800">{uploadWarning}</p>
                </div>
                <button
                  onClick={() => setUploadWarning(null)}
                  className="text-amber-400 hover:text-amber-600 text-sm"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Stamp Display (locked) */}
          {stampDisplay && (
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
              <div className="text-xs text-gray-500 font-mono whitespace-pre-line">
                {stampDisplay}
              </div>
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-6 text-sm text-gray-400 animate-pulse">Loading...</p>
            ) : (
              <LiveMarkdownEditor
                value={content}
                onChange={setContent}
                placeholder="Click to start writing results..."
                onImageDrop={handleImageUpload}
                imageBasePath={`results/task-${task.id}`}
                showToolbar={true}
                onBrowseImages={() => setShowImageGallery(true)}
              />
            )}
          </div>
        </>
      ) : (
        <PdfAttachmentsPanel task={task} pdfsDir={pdfsDir} label="Results" onFilesChange={setFileCount} />
      )}
      
      {/* Image Gallery Popup */}
      <ImageGalleryPopup
        isOpen={showImageGallery}
        onClose={() => setShowImageGallery(false)}
        experimentId={task.id}
        experimentName={task.name}
        experimentDate={task.start_date}
        onInsertImage={handleInsertImageFromGallery}
      />
    </div>
    </>
  );
}

// ── PDF Attachments Panel ─────────────────────────────────────────────────────

// Helper to determine if a file is renderable in browser
const isRenderableFile = (filename: string): boolean => {
  const ext = filename.toLowerCase().split('.').pop() || '';
  return ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'md', 'txt'].includes(ext);
};

// Helper to determine if a file is markdown
const isMarkdownFile = (filename: string): boolean => {
  const ext = filename.toLowerCase().split('.').pop() || '';
  return ext === 'md';
};

// Helper to get file icon based on extension
const getFileIcon = (filename: string): string => {
  const ext = filename.toLowerCase().split('.').pop() || '';
  if (ext === 'pdf') return '📕';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return '🖼️';
  if (ext === 'md') return '📝';
  if (ext === 'txt') return '📄';
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['xls', 'xlsx'].includes(ext)) return '📗';
  if (['ppt', 'pptx'].includes(ext)) return '📙';
  if (['zip', 'tar', 'gz'].includes(ext)) return '📦';
  return '📎';
};

// Helper to get MIME type
const getMimeType = (filename: string): string => {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const mimeTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
  };
  return mimeTypes[ext] || 'application/octet-stream';
};

function PdfAttachmentsPanel({ task, pdfsDir, label, onFilesChange }: { task: Task; pdfsDir: string; label: string; onFilesChange?: (count: number) => void }) {
  const [files, setFiles] = useState<PdfAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeFile, setActiveFile] = useState<PdfAttachment | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load files from directory
  useEffect(() => {
    loadFiles();
  }, [pdfsDir]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const dirFiles = await githubApi.listDirectory(pdfsDir);
      
      const attachments: PdfAttachment[] = dirFiles.map((f: GitHubTreeItem) => ({
        name: f.name,
        path: f.path,
        url: null,
        loading: false,
        isRenderable: isRenderableFile(f.name),
      }));
      
      setFiles(attachments);
      // Notify parent of file count
      if (onFilesChange) {
        onFilesChange(attachments.length);
      }
    } catch {
      // Directory doesn't exist yet
      setFiles([]);
      if (onFilesChange) {
        onFilesChange(0);
      }
    }
    setLoading(false);
  }, [pdfsDir, onFilesChange]);

  // Handle file upload
  const handleUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    
    setUploading(true);
    for (const file of Array.from(fileList)) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(",")[1];
          const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
          const filePath = `${pdfsDir}/${fileName}`;
          
          await githubApi.uploadImage(
            filePath,
            base64,
            `Upload file for ${label}: ${file.name}`
          );
          
          // Refresh the list
          await loadFiles();
        } catch {
          alert(`Failed to upload ${file.name}`);
        }
      };
      reader.readAsDataURL(file);
    }
    setUploading(false);
  }, [pdfsDir, label, loadFiles]);

  // Load and display a file
  const handleViewFile = useCallback(async (file: PdfAttachment) => {
    if (!file.isRenderable) {
      // For non-renderable files, offer download
      try {
        const fileData = await githubApi.readFile(file.path);
        const binaryString = atob(fileData.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: getMimeType(file.name) });
        const url = URL.createObjectURL(blob);
        
        // Create download link
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        alert("Failed to download file");
      }
      return;
    }
    
    setActiveFile(file);
    setFileUrl(null);
    setMarkdownContent(null);
    
    try {
      const fileData = await githubApi.readFile(file.path);
      
      // Check if it's a markdown file - render with ReactMarkdown
      if (isMarkdownFile(file.name)) {
        // Decode base64 to text
        const binaryString = atob(fileData.content);
        const textContent = decodeURIComponent(escape(binaryString));
        setMarkdownContent(textContent);
      } else {
        // For PDFs and images, create blob URL for iframe
        const binaryString = atob(fileData.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: getMimeType(file.name) });
        const url = URL.createObjectURL(blob);
        setFileUrl(url);
      }
    } catch {
      alert("Failed to load file");
      setActiveFile(null);
    }
  }, []);

  // Delete a file
  const handleDeleteFile = useCallback(async (file: PdfAttachment) => {
    if (!confirm(`Delete "${file.name}"?`)) return;
    
    try {
      // GitHub API doesn't have a delete method, so we'll use the image delete approach
      // For now, just remove from the list (actual deletion would need backend support)
      setFiles((prev) => prev.filter((f) => f.path !== file.path));
      if (activeFile?.path === file.path) {
        setActiveFile(null);
        setFileUrl(null);
        setMarkdownContent(null);
      }
    } catch {
      alert("Failed to delete file");
    }
  }, [activeFile]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  if (activeFile) {
    const isMarkdown = isMarkdownFile(activeFile.name);
    
    return (
      <div className="flex flex-col h-full">
        {/* File Viewer Header */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50">
          <button
            onClick={() => {
              setActiveFile(null);
              setFileUrl(null);
              setMarkdownContent(null);
            }}
            className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
          >
            ← Back to Files
          </button>
          <span className="text-sm text-gray-600 truncate">{activeFile.name}</span>
        </div>
        
        {/* File Viewer */}
        <div className="flex-1 overflow-hidden">
          {isMarkdown ? (
            markdownContent ? (
              <div className="h-full overflow-y-auto p-6 prose prose-sm prose-gray max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {markdownContent}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-gray-400 animate-pulse">Loading...</p>
              </div>
            )
          ) : (
            fileUrl ? (
              <iframe
                src={fileUrl}
                className="w-full h-full"
                title={activeFile.name}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-gray-400 animate-pulse">Loading...</p>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {uploading ? "Uploading..." : "📎 Add File"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        <span className="text-xs text-gray-400">
          PDFs & images viewable, other files downloadable
        </span>
        <div className="flex-1" />
        <span className="text-xs text-gray-400">
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-sm text-gray-400 animate-pulse">Loading files...</p>
        ) : files.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">📎</p>
            <p className="text-sm text-gray-400 mb-1">No files attached yet</p>
            <p className="text-xs text-gray-300">
              Upload PDFs (viewable), images (viewable), or other files (downloadable)
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {files.map((file) => (
              <div
                key={file.path}
                className="group relative bg-gray-50 border border-gray-200 rounded-lg p-4 hover:bg-gray-100 transition-colors cursor-pointer"
                onClick={() => handleViewFile(file)}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{getFileIcon(file.name)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {file.isRenderable ? "Click to view" : "Click to download"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteFile(file);
                  }}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                  title="Delete file"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Export Button Component ───────────────────────────────────────────────────

function ExportButton({ task }: { task: Task }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [exporting, setExporting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch project name
  const { data: project } = useQuery({
    queryKey: ["project", task.project_id],
    queryFn: () => projectsApi.get(task.project_id),
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleExport = useCallback(async (format: 'markdown' | 'pdf') => {
    setExporting(true);
    setShowDropdown(false);
    
    try {
      const projectName = project?.name || "Unknown Project";
      
      // Fetch lab notes
      let labNotes: string | null = null;
      try {
        const notesFile = await githubApi.readFile(`results/task-${task.id}/notes.md`);
        labNotes = notesFile.content;
      } catch {
        // Notes don't exist
      }

      // Fetch method
      let method: Method | null = null;
      let methodContent: string | null = null;
      if (task.method_id) {
        try {
          method = await methodsApi.get(task.method_id);
          if (method.github_path) {
            const methodFile = await githubApi.readFile(method.github_path);
            methodContent = methodFile.content;
          }
        } catch {
          // Method doesn't exist
        }
      }

      // Fetch results
      let results: string | null = null;
      try {
        const resultsFile = await githubApi.readFile(`results/task-${task.id}/results.md`);
        results = resultsFile.content;
      } catch {
        // Results don't exist
      }

      // Get PDF attachments
      const pdfAttachments: string[] = [];
      try {
        const notesPdfs = await githubApi.listDirectory(`results/task-${task.id}/NotesPDFs`);
        pdfAttachments.push(...notesPdfs.map((f: GitHubTreeItem) => f.path));
      } catch {
        // Directory doesn't exist
      }
      try {
        const resultsPdfs = await githubApi.listDirectory(`results/task-${task.id}/ResultsPDFs`);
        pdfAttachments.push(...resultsPdfs.map((f: GitHubTreeItem) => f.path));
      } catch {
        // Directory doesn't exist
      }

      const exportData: ExperimentExportData = {
        task,
        projectName,
        labNotes,
        method,
        methodContent,
        results,
        pdfAttachments,
      };

      const options: ExportOptions = {
        format,
        includeLabNotes: true,
        includeMethod: true,
        includeResults: true,
        includeAttachments: true,
      };

      await exportSingleExperiment(exportData, options);
    } catch (error) {
      console.error("Export failed:", error);
      alert("Failed to export experiment");
    } finally {
      setExporting(false);
    }
  }, [task, project]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={exporting}
        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
        title="Export experiment"
      >
        {exporting ? (
          <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        )}
      </button>

      {showDropdown && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
          <button
            onClick={() => handleExport('markdown')}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <span>📝</span> Markdown
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <span>📕</span> PDF
          </button>
        </div>
      )}
    </div>
  );
}
