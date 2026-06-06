"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { codingWorkflowApi } from "@/lib/local-api";
import type {
  Method,
  Task,
  TaskMethodAttachment,
} from "@/lib/types";
import { getMethodTypeMeta } from "@/lib/methods/method-type-registry";
import { CodingWorkflowRenderer } from "@/components/CodingWorkflowViewer";
import VariationNotesPanel from "./VariationNotesPanel";

interface CodingWorkflowMethodTabContentProps {
  task: Task;
  method: Method;
  methodId: number;
  attachment: TaskMethodAttachment | undefined;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean;
  hideVariationNotes?: boolean;
}

function extractProtocolId(sourcePath: string): number | null {
  const match = sourcePath.match(/^coding_workflow:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Read-only experiment-page tab for a coding-workflow method. Per Q-B4
 * lock there's no per-task snapshot — the renderer simply reads the
 * source-side protocol. Variation notes are the universal fallback for
 * "I deviated here on this task."
 */
export default function CodingWorkflowMethodTabContent({
  task,
  method,
  methodId,
  attachment,
  onTaskUpdate,
  readOnly = false,
  hideVariationNotes = false,
}: CodingWorkflowMethodTabContentProps) {
  const queryClient = useQueryClient();
  const meta = getMethodTypeMeta("coding_workflow");

  const protocolId = method.source_path ? extractProtocolId(method.source_path) : null;
  const protocolOwner = method.owner || undefined;

  const { data: protocol, isLoading } = useQuery({
    queryKey: ["coding-workflow", protocolId, protocolOwner],
    queryFn: () => codingWorkflowApi.get(protocolId!, protocolOwner),
    enabled: protocolId !== null,
  });

  return (
    <div className="flex flex-col h-full">
      {!hideVariationNotes && (
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
      )}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-body font-medium text-foreground">
              {method.name || "Coding workflow"}
            </span>
            <span className={`text-meta px-1.5 py-0.5 rounded ${meta.color.bg} ${meta.color.text}`}>
              {meta.shortLabel}
            </span>
          </div>
        </div>
        {isLoading ? (
          <p className="text-body text-foreground-muted animate-pulse">Loading…</p>
        ) : !protocol ? (
          <p className="text-body text-foreground-muted">No coding workflow data available</p>
        ) : (
          <CodingWorkflowRenderer
            language={protocol.language}
            languageLabel={protocol.language_label ?? null}
            embeddedCode={protocol.embedded_code}
            externalPath={protocol.external_path}
            outputRenderer={protocol.output_renderer}
            description={protocol.description ?? null}
          />
        )}
      </div>
    </div>
  );
}
