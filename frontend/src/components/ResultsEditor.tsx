"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { githubApi, projectsApi } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import LiveMarkdownEditor from "./LiveMarkdownEditor";
import type { Task } from "@/lib/types";
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

interface ResultsEditorProps {
  task: Task;
  onClose: () => void;
}

interface Attachment {
  name: string;
  path: string;
  type: "image" | "pdf" | "other";
  size: number;
}

/**
 * Results Editor: Markdown editor with file attachments support.
 * Features tabs for markdown content and attachments.
 */
export default function ResultsEditor({ task, onClose }: ResultsEditorProps) {
  const [activeTab, setActiveTab] = useState<"markdown" | "attachments">("markdown");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
  const [stamp, setStamp] = useState<StampData | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Track unsaved changes
  const hasUnsavedChanges = content !== originalContent && !loading;
  
  // Warn user about unsaved changes when navigating away
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

  const resultDir = `results/task-${task.id}`;
  const resultPath = `${resultDir}/notes.md`;
  const imagesDir = `${resultDir}/Images`;
  const attachmentsDir = `${resultDir}/Attachments`;

  // Fetch project name
  const { data: project } = useQuery({
    queryKey: ["project", task.project_id],
    queryFn: () => projectsApi.get(task.project_id),
  });

  const projectName = project?.name || "Unknown Project";

  // Load markdown content
  useEffect(() => {
    githubApi
      .readFile(resultPath)
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
            resultPath,
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
        const newContent = createNewFileContent(task.name, projectName);
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
  }, [resultPath, task.name, projectName]);

  // Load attachments
  const loadAttachments = useCallback(async () => {
    setAttachmentsLoading(true);
    try {
      const items = await githubApi.listDirectory(resultDir);
      const atts: Attachment[] = items
        .filter((item) => item.type === "file" && item.name !== "notes.md")
        .map((item) => {
          const ext = item.name.split(".").pop()?.toLowerCase() || "";
          let type: "image" | "pdf" | "other" = "other";
          if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
            type = "image";
          } else if (ext === "pdf") {
            type = "pdf";
          }
          return {
            name: item.name,
            path: item.path,
            type,
            size: item.size,
          };
        });
      setAttachments(atts);
    } catch {
      // Directory doesn't exist yet
      setAttachments([]);
    } finally {
      setAttachmentsLoading(false);
    }
  }, [resultDir]);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  // Handle file upload (saves to attachments folder, does NOT embed in markdown)
  const handleFileUpload = useCallback(
    async (files: FileList | File[]) => {
      setUploading(true);
      setUploadWarning(null);
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
          const filePath = `${attachmentsDir}/${fileName}`;

          try {
            const response = await githubApi.uploadImage(
              filePath,
              base64,
              `Upload attachment for task ${task.name}: ${file.name}`
            );
            await loadAttachments();
            
            // Show warning if file is too large for GitHub
            if (response.warning) {
              setUploadWarning(response.warning);
            }
          } catch {
            alert(`Failed to upload ${file.name}`);
          }
        };
        reader.readAsDataURL(file);
      }
      setUploading(false);
    },
    [attachmentsDir, task.name, loadAttachments]
  );

  // Handle image upload for LiveMarkdownEditor (from drag-drop, paste, or file picker)
  const handleImageUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const imageName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
          const imagePath = `${imagesDir}/${imageName}`;

          try {
            const response = await githubApi.uploadImage(
              imagePath,
              base64,
              `Upload image for task ${task.name}`
            );
            // Insert markdown image reference with relative path
            const imageMarkdown = `\n![${file.name}](./Images/${imageName})\n`;
            setContent((prev) => prev + imageMarkdown);
            await loadAttachments();
            
            // Show warning if file is too large for GitHub
            if (response.warning) {
              setUploadWarning(response.warning);
            }
          } catch {
            alert(`Failed to upload ${file.name}`);
          }
        };
        reader.readAsDataURL(file);
      }
      setUploading(false);
    },
    [imagesDir, task.name, loadAttachments]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Update stamp names before saving (in case experiment/project was renamed)
      let contentToSave = updateStampNames(content, task.name, projectName);
      contentToSave = updateLastAccess(contentToSave);
      
      await githubApi.writeFile(
        resultPath,
        contentToSave,
        `Update results for task: ${task.name}`
      );
      setContent(contentToSave);
      setOriginalContent(contentToSave); // Update original content after successful save
    } catch {
      alert("Failed to save results");
    } finally {
      setSaving(false);
    }
  }, [content, resultPath, task.name, projectName]);
  
  // Handle close with unsaved changes warning
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      const shouldClose = confirm("You have unsaved changes. Are you sure you want to close without saving?");
      if (!shouldClose) return;
    }
    onClose();
  }, [hasUnsavedChanges, onClose]);

  const handleDeleteAttachment = useCallback(
    async (attachment: Attachment) => {
      if (!confirm(`Delete ${attachment.name}?`)) return;
      try {
        // Delete by using the deleteDirectory endpoint for single file
        await githubApi.deleteDirectory(attachment.path);
        await loadAttachments();
        if (selectedAttachment?.path === attachment.path) {
          setSelectedAttachment(null);
        }
      } catch {
        alert("Failed to delete attachment");
      }
    },
    [loadAttachments, selectedAttachment]
  );

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Render stamp display with current names
  const stampDisplay = stamp ? renderStampDisplay(stamp, task.name, projectName) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Results: {task.name}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {task.start_date} · {task.duration_days} days
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === "markdown" && (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="px-3 py-1.5 text-xs bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-100 disabled:opacity-50"
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
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            )}
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 text-lg ml-2"
            >
              &#10005;
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setActiveTab("markdown")}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === "markdown"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Notes
          </button>
          <button
            onClick={() => setActiveTab("attachments")}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === "attachments"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Attachments ({attachments.length})
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

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "markdown" ? (
            <div className="flex flex-col h-full">
              {/* Stamp Display (locked) */}
              {stampDisplay && (
                <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
                  <div className="text-xs text-gray-500 font-mono whitespace-pre-line">
                    {stampDisplay}
                  </div>
                  <div className="border-t border-gray-200 mt-2" />
                </div>
              )}
              
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <p className="p-6 text-sm text-gray-400 animate-pulse">
                    Loading...
                  </p>
                ) : (
                  <LiveMarkdownEditor
                    value={content}
                    onChange={setContent}
                    placeholder="Click to start writing results..."
                    onImageDrop={handleImageUpload}
                    imageBasePath={resultDir}
                    showToolbar={true}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-6">
              {/* Upload area */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors mb-6"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleFileUpload(e.target.files);
                    e.target.value = "";
                  }}
                />
                {uploading ? (
                  <p className="text-sm text-gray-500">Uploading...</p>
                ) : (
                  <div>
                    <p className="text-sm text-gray-500">
                      Click to upload files or drag & drop
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Images, PDFs, and other files supported
                    </p>
                  </div>
                )}
              </div>

              {/* Attachments list */}
              {attachmentsLoading ? (
                <p className="text-sm text-gray-400 animate-pulse">
                  Loading attachments...
                </p>
              ) : attachments.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">
                  No attachments yet. Upload files above.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {attachments.map((att) => (
                    <div
                      key={att.path}
                      className={`border rounded-lg overflow-hidden cursor-pointer transition-all ${
                        selectedAttachment?.path === att.path
                          ? "border-blue-400 ring-2 ring-blue-200"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                      onClick={() => setSelectedAttachment(att)}
                    >
                      {/* Preview */}
                      <div className="h-32 bg-gray-50 flex items-center justify-center">
                        {att.type === "image" ? (
                          <img
                            src={githubApi.getRawUrl(att.path)}
                            alt={att.name}
                            className="max-h-full max-w-full object-contain"
                          />
                        ) : att.type === "pdf" ? (
                          <div className="text-center">
                            <span className="text-3xl">&#128196;</span>
                            <p className="text-xs text-gray-500 mt-1">PDF</p>
                          </div>
                        ) : (
                          <div className="text-center">
                            <span className="text-3xl">&#128206;</span>
                            <p className="text-xs text-gray-500 mt-1">File</p>
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div className="p-2 border-t border-gray-100">
                        <p className="text-xs font-medium text-gray-700 truncate">
                          {att.name}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          {formatFileSize(att.size)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Selected attachment preview */}
              {selectedAttachment && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                  <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                      <h4 className="text-sm font-semibold text-gray-900">
                        {selectedAttachment.name}
                      </h4>
                      <div className="flex items-center gap-2">
                        <a
                          href={githubApi.getRawUrl(selectedAttachment.path)}
                          download={selectedAttachment.name}
                          className="px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg"
                        >
                          Download
                        </a>
                        <button
                          onClick={() => handleDeleteAttachment(selectedAttachment)}
                          className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setSelectedAttachment(null)}
                          className="text-gray-400 hover:text-gray-600 text-lg ml-2"
                        >
                          &#10005;
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto p-6">
                      {selectedAttachment.type === "image" ? (
                        <img
                          src={githubApi.getRawUrl(selectedAttachment.path)}
                          alt={selectedAttachment.name}
                          className="max-w-full max-h-full mx-auto"
                        />
                      ) : selectedAttachment.type === "pdf" ? (
                        <iframe
                          src={githubApi.getRawUrl(selectedAttachment.path)}
                          className="w-full h-full min-h-[500px]"
                          title={selectedAttachment.name}
                        />
                      ) : (
                        <div className="text-center py-12">
                          <p className="text-sm text-gray-500">
                            Preview not available for this file type.
                          </p>
                          <a
                            href={githubApi.getRawUrl(selectedAttachment.path)}
                            download={selectedAttachment.name}
                            className="mt-4 inline-block px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                          >
                            Download File
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
