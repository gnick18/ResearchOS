"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { filesApi } from "@/lib/local-api";
import type { Method, Task, TaskMethodAttachment } from "@/lib/types";
import VariationNotesPanel from "./VariationNotesPanel";

interface PdfMethodTabContentProps {
  task: Task;
  method: Method;
  methodId: number;
  attachment: TaskMethodAttachment | undefined;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean;
}

export default function PdfMethodTabContent({
  task,
  method,
  methodId,
  attachment,
  onTaskUpdate,
  readOnly = false,
}: PdfMethodTabContentProps) {
  const queryClient = useQueryClient();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!method.source_path) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- short-circuit when no source path means we can't load anything
      setLoading(false);
      setPdfUrl(null);
      return;
    }
    setLoading(true);
    let revokedUrl: string | null = null;
    filesApi
      .readFile(method.source_path)
      .then((file) => {
        // The content comes back as base64 for binary files
        try {
          const binary = atob(file.content);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: "application/pdf" });
          const url = URL.createObjectURL(blob);
          revokedUrl = url;
          setPdfUrl(url);
        } catch {
          setPdfUrl(null);
        }
        setLoading(false);
      })
      .catch(() => {
        setPdfUrl(null);
        setLoading(false);
      });

    return () => {
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [method.source_path]);

  if (loading) {
    return <div className="p-6 text-sm text-gray-400 animate-pulse">Loading method...</div>;
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Variation Notes Panel */}
      <VariationNotesPanel
        task={task}
        methodId={methodId}
        variationNotes={attachment?.variation_notes || null}
        onSaved={(updatedTask) => {
          // Local state update mirrors the pattern used by every other
          // mutating handler in this file (handleAddMethod, etc). The
          // ["task", task.id] refetch below is a no-op for the popup's
          // actual query key (`["task", taskKey(task)]`), but the
          // `["tasks"] / ["allTasks"]` refetches still matter for the
          // calendar/Gantt views that key on a plain tasks list.
          if (updatedTask) onTaskUpdate?.(updatedTask);
          queryClient.refetchQueries({ queryKey: ["tasks"] });
          queryClient.refetchQueries({ queryKey: ["allTasks"] });
        }}
        readOnly={readOnly}
      />
      {pdfUrl ? (
        <iframe
          src={pdfUrl}
          className="w-full h-full min-h-[500px] flex-1"
          title={method.name || "PDF Method"}
        />
      ) : (
        <div className="p-6 text-center">
          <p className="text-sm text-gray-500">Unable to display PDF. The file may not exist yet.</p>
        </div>
      )}
    </div>
  );
}
