"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { useQueryClient } from "@tanstack/react-query";
import { filesApi } from "@/lib/local-api";
import { migrateNoteImages } from "@/lib/notes/migrate-images";
import type { Method, Task, TaskMethodAttachment } from "@/lib/types";
import VariationNotesPanel from "./VariationNotesPanel";

interface MarkdownMethodTabContentProps {
  task: Task;
  method: Method;
  methodId: number;
  attachment: TaskMethodAttachment | undefined;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean;
}

export default function MarkdownMethodTabContent({
  task,
  method,
  methodId,
  attachment,
  onTaskUpdate,
  readOnly = false,
}: MarkdownMethodTabContentProps) {
  const queryClient = useQueryClient();
  const [methodContent, setMethodContent] = useState("");
  const [loading, setLoading] = useState(true);

  // Load method content from disk. In readOnly (lab) mode skip the
  // legacy-image-migration save-back; just display the raw content. The
  // actual file rewrite happens the next time an owner opens the method
  // directly.
  useEffect(() => {
    if (!method.source_path) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- short-circuit when no source path means we can't load anything
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const sourcePath = method.source_path;
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
        const legacyOwner = method.owner || method.created_by || undefined;
        const { content: migrated, didMigrate } = await migrateNoteImages(raw, slug, dir, legacyOwner);
        if (didMigrate) {
          await filesApi.writeFile(sourcePath, migrated, `Migrate image references for: ${method.name}`);
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
  }, [method.source_path, method.owner, method.created_by, method.name, readOnly]);

  if (loading) {
    return <div className="p-6 text-sm text-gray-400 animate-pulse">Loading method...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Variation Notes Panel */}
      <VariationNotesPanel
        task={task}
        methodId={methodId}
        variationNotes={attachment?.variation_notes || null}
        onSaved={(updatedTask) => {
          if (updatedTask) onTaskUpdate?.(updatedTask);
          queryClient.refetchQueries({ queryKey: ["tasks"] });
          queryClient.refetchQueries({ queryKey: ["allTasks"] });
        }}
        readOnly={readOnly}
      />
      <div className="flex-1 overflow-y-auto p-6 prose prose-sm prose-gray max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
          {methodContent}
        </ReactMarkdown>
      </div>
    </div>
  );
}
