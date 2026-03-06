"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Note, NoteEntry } from "@/lib/types";
import { notesApi } from "@/lib/api";
import LiveMarkdownEditor from "./LiveMarkdownEditor";

interface NoteDetailPopupProps {
  note: Note;
  onClose: () => void;
  onUpdate: (note: Note) => void;
  onDelete: (noteId: number) => void;
  readOnly?: boolean;
}

// Debounce helper with cancel capability
function useDebouncedCallback<T extends (...args: string[]) => void>(
  callback: T,
  delay: number
): { debounced: T; cancel: () => void; flush: () => void } {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const argsRef = useRef<Parameters<T> | null>(null);
  
  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      argsRef.current = null;
    }
  }, []);
  
  const flush = useCallback(() => {
    if (timeoutRef.current && argsRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      callback(...argsRef.current);
      argsRef.current = null;
    }
  }, [callback]);
  
  const debounced = useCallback(
    ((...args: Parameters<T>) => {
      argsRef.current = args;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
        argsRef.current = null;
      }, delay);
    }) as T,
    [callback, delay]
  );
  
  return { debounced, cancel, flush };
}

export default function NoteDetailPopup({
  note,
  onClose,
  onUpdate,
  onDelete,
  readOnly = false,
}: NoteDetailPopupProps) {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [description, setDescription] = useState(note.description);
  const [entries, setEntries] = useState<NoteEntry[]>(note.entries);
  const [isShared, setIsShared] = useState(note.is_shared);
  const [saving, setSaving] = useState(false);
  const [showNewEntryForm, setShowNewEntryForm] = useState(false);
  const [newEntryTitle, setNewEntryTitle] = useState("");
  const [newEntryDate, setNewEntryDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  
  // Track unsaved content for auto-save
  const unsavedContentRef = useRef<Map<string, string>>(new Map());
  const isSavingRef = useRef(false);
  const isClosingRef = useRef(false);

  // Set initial active tab
  useEffect(() => {
    if (note.entries.length > 0 && !activeTab) {
      if (note.is_running_log) {
        // Sort entries by date descending and select the most recent
        const sorted = [...note.entries].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        setActiveTab(sorted[0].id);
      } else {
        // Single note - set the first (and only) entry as active
        setActiveTab(note.entries[0].id);
      }
    }
  }, [note.is_running_log, note.entries, activeTab]);

  // Get the current entry being edited
  const currentEntry = entries.find((e) => e.id === activeTab);

  // Debounced save function
  const saveEntryContent = useCallback(
    async (entryId: string, content: string) => {
      if (isSavingRef.current) return;
      
      isSavingRef.current = true;
      setSaving(true);
      
      try {
        const updated = await notesApi.updateEntry(note.id, entryId, { content });
        // Only update state if we're not closing
        if (!isClosingRef.current) {
          setEntries(updated.entries);
        }
        unsavedContentRef.current.delete(entryId);
        onUpdate(updated);
      } catch (error) {
        console.error("Failed to save entry content:", error);
      } finally {
        setSaving(false);
        isSavingRef.current = false;
      }
    },
    [note.id, onUpdate]
  );

  // Debounced save (1.5 seconds after user stops typing)
  const { debounced: debouncedSave, flush: flushDebouncedSave, cancel: cancelDebouncedSave } = useDebouncedCallback(
    (entryId: string, content: string) => {
      saveEntryContent(entryId, content);
    },
    1500
  );

  // Handle close with save - saves any pending changes before closing
  const handleClose = useCallback(async () => {
    // Mark that we're closing to prevent state updates after save
    isClosingRef.current = true;
    
    // Cancel any pending debounced saves
    cancelDebouncedSave();
    
    // Save any unsaved content immediately
    if (unsavedContentRef.current.size > 0) {
      setSaving(true);
      try {
        // Save all unsaved entries in parallel
        const savePromises = Array.from(unsavedContentRef.current.entries()).map(
          ([entryId, content]) => notesApi.updateEntry(note.id, entryId, { content })
        );
        await Promise.all(savePromises);
        unsavedContentRef.current.clear();
      } catch (error) {
        console.error("Failed to save pending changes:", error);
      } finally {
        setSaving(false);
      }
    }
    
    onClose();
  }, [note.id, onClose, cancelDebouncedSave]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [handleClose]);

  // Save title
  const saveTitle = async () => {
    if (title === note.title) {
      setEditingTitle(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await notesApi.update(note.id, { title });
      onUpdate(updated);
      setEditingTitle(false);
    } catch (error) {
      console.error("Failed to save title:", error);
      setTitle(note.title);
    } finally {
      setSaving(false);
    }
  };

  // Save description
  const saveDescription = async () => {
    if (description === note.description) {
      setEditingDescription(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await notesApi.update(note.id, { description });
      onUpdate(updated);
      setEditingDescription(false);
    } catch (error) {
      console.error("Failed to save description:", error);
      setDescription(note.description);
    } finally {
      setSaving(false);
    }
  };

  // Toggle sharing
  const toggleSharing = async () => {
    setSaving(true);
    try {
      const updated = await notesApi.update(note.id, { is_shared: !isShared });
      setIsShared(updated.is_shared);
      onUpdate(updated);
    } catch (error) {
      console.error("Failed to toggle sharing:", error);
    } finally {
      setSaving(false);
    }
  };

  // Update entry content - immediate local update, debounced API save
  const updateEntryContent = useCallback(
    (content: string) => {
      if (!activeTab) return;

      // Immediate local update for responsive UI
      setEntries((prev) =>
        prev.map((e) =>
          e.id === activeTab ? { ...e, content, updated_at: new Date().toISOString() } : e
        )
      );

      // Track unsaved content
      unsavedContentRef.current.set(activeTab, content);
      
      // Trigger debounced save
      debouncedSave(activeTab, content);
    },
    [activeTab, debouncedSave]
  );

  // Add new entry
  const addNewEntry = async () => {
    if (!newEntryTitle.trim()) return;

    setSaving(true);
    try {
      const updated = await notesApi.addEntry(note.id, {
        title: newEntryTitle,
        date: newEntryDate,
        content: "",
      });
      setEntries(updated.entries);
      setActiveTab(updated.entries[updated.entries.length - 1].id);
      setShowNewEntryForm(false);
      setNewEntryTitle("");
      setNewEntryDate(new Date().toISOString().split("T")[0]);
      onUpdate(updated);
    } catch (error) {
      console.error("Failed to add entry:", error);
    } finally {
      setSaving(false);
    }
  };

  // Delete entry
  const deleteEntry = async (entryId: string) => {
    if (!confirm("Are you sure you want to delete this entry?")) return;

    setSaving(true);
    try {
      const updated = await notesApi.deleteEntry(note.id, entryId);
      setEntries(updated.entries);
      // Select another tab if the deleted one was active
      if (activeTab === entryId && updated.entries.length > 0) {
        setActiveTab(updated.entries[0].id);
      }
      onUpdate(updated);
    } catch (error) {
      console.error("Failed to delete entry:", error);
    } finally {
      setSaving(false);
    }
  };

  // Delete note
  const handleDeleteNote = async () => {
    if (!confirm("Are you sure you want to delete this entire note?")) return;

    try {
      await notesApi.delete(note.id);
      onDelete(note.id);
      onClose();
    } catch (error) {
      console.error("Failed to delete note:", error);
    }
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 mr-4">
              {/* Title */}
              {editingTitle ? (
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => e.key === "Enter" && saveTitle()}
                  className="text-xl font-bold text-gray-900 w-full border-b-2 border-emerald-500 focus:outline-none bg-transparent"
                  autoFocus
                  disabled={readOnly}
                />
              ) : (
                <h2
                  onClick={() => !readOnly && setEditingTitle(true)}
                  className={`text-xl font-bold text-gray-900 ${
                    !readOnly ? "cursor-pointer hover:text-emerald-600" : ""
                  }`}
                >
                  {title}
                </h2>
              )}

              {/* Description */}
              {editingDescription ? (
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={saveDescription}
                  onKeyDown={(e) => e.key === "Enter" && saveDescription()}
                  placeholder="Add a description..."
                  className="text-sm text-gray-500 w-full border-b-2 border-emerald-500 focus:outline-none bg-transparent mt-1"
                  autoFocus
                  disabled={readOnly}
                />
              ) : (
                <p
                  onClick={() => !readOnly && setEditingDescription(true)}
                  className={`text-sm text-gray-500 mt-1 ${
                    !readOnly ? "cursor-pointer hover:text-emerald-600" : ""
                  }`}
                >
                  {description || (!readOnly ? "Add a description..." : "")}
                </p>
              )}
            </div>

            {/* Close button */}
            <button
              onClick={handleClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Sharing toggle */}
          {!readOnly && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={toggleSharing}
                disabled={saving}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isShared
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {isShared ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  )}
                </svg>
                {isShared ? "Shared with lab" : "Private"}
              </button>
              
              {/* Auto-save indicator */}
              {saving && (
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </span>
              )}
            </div>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Tabs for running logs */}
          {note.is_running_log && (
            <div className="border-b border-gray-200 px-4 py-2 flex-shrink-0">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {entries
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => setActiveTab(entry.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                        activeTab === entry.id
                          ? "bg-emerald-100 text-emerald-700 font-medium"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {entry.title}
                    </button>
                  ))}

                {/* Add entry button */}
                {!readOnly && (
                  <button
                    onClick={() => setShowNewEntryForm(true)}
                    className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Entry
                  </button>
                )}
              </div>
            </div>
          )}

          {/* New entry form */}
          {showNewEntryForm && (
            <div className="border-b border-gray-200 px-4 py-3 bg-gray-50 flex-shrink-0">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={newEntryTitle}
                  onChange={(e) => setNewEntryTitle(e.target.value)}
                  placeholder="Entry title..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
                <input
                  type="date"
                  value={newEntryDate}
                  onChange={(e) => setNewEntryDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={addNewEntry}
                  disabled={!newEntryTitle.trim() || saving}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Add
                </button>
                <button
                  onClick={() => setShowNewEntryForm(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Entry info bar */}
          {note.is_running_log && currentEntry && (
            <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 flex-shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">
                  Date: <span className="font-medium text-gray-700">{formatDate(currentEntry.date)}</span>
                </span>
                <span className="text-xs text-gray-400">
                  Updated: {formatDate(currentEntry.updated_at)}
                </span>
              </div>
              {!readOnly && entries.length > 1 && (
                <button
                  onClick={() => deleteEntry(currentEntry.id)}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  Delete Entry
                </button>
              )}
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 overflow-y-auto">
            {note.is_running_log ? (
              currentEntry ? (
                <LiveMarkdownEditor
                  value={currentEntry.content}
                  onChange={updateEntryContent}
                  placeholder="Write your meeting notes in Markdown..."
                  disabled={readOnly}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <p>No entries yet. Click "Add Entry" to get started.</p>
                </div>
              )
            ) : (
              // Single note - use the first (and only) entry
              entries[0] && (
                <LiveMarkdownEditor
                  value={entries[0].content}
                  onChange={(content) => {
                    if (entries[0]) {
                      updateEntryContent(content);
                    }
                  }}
                  placeholder="Write your meeting notes in Markdown..."
                  disabled={readOnly}
                />
              )
            )}
          </div>
        </div>

        {/* Footer */}
        {!readOnly && (
          <div className="p-4 border-t border-gray-200 flex items-center justify-between flex-shrink-0">
            <div className="text-xs text-gray-400">
              Created: {formatDate(note.created_at)} • Updated: {formatDate(note.updated_at)}
            </div>
            <button
              onClick={handleDeleteNote}
              className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              Delete Note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
