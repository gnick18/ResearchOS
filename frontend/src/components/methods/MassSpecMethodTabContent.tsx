"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { massSpecApi } from "@/lib/local-api";
import type {
  Method,
  Task,
  TaskMethodAttachment,
} from "@/lib/types";
import MassSpecEditor from "@/components/MassSpecEditor";
import VariationNotesPanel from "./VariationNotesPanel";

/**
 * Experiment-page tab content for a mass spec method. Per proposal §4.5,
 * mass spec is a "static template" — no per-task snapshot, no per-experiment
 * editing of the protocol fields. Users who want to change the mass spec
 * parameters go to /methods and edit the source record there.
 *
 * On the experiment page we show:
 *   - the variation notes panel (free-text "we ran this slightly differently
 *     today" log; this is the only per-task customization for mass spec)
 *   - a read-only render of the source protocol
 */
interface MassSpecMethodTabContentProps {
  task: Task;
  method: Method;
  methodId: number;
  attachment: TaskMethodAttachment | undefined;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean;
  /** Compound-child mode: mass spec has no per-task snapshot state, so this
   *  viewer ignores any nested-snapshot adapter. The prop is accepted for
   *  prop-shape consistency with the other per-type viewers when invoked
   *  inside a compound. */
  hideVariationNotes?: boolean;
}

function extractMassSpecProtocolId(sourcePath: string): number | null {
  const match = sourcePath.match(/^mass_spec:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export default function MassSpecMethodTabContent({
  task,
  method,
  methodId,
  attachment,
  onTaskUpdate,
  readOnly = false,
  hideVariationNotes = false,
}: MassSpecMethodTabContentProps) {
  const queryClient = useQueryClient();
  const [showAllFields, setShowAllFields] = useState(false);

  const msProtocolId = method.source_path ? extractMassSpecProtocolId(method.source_path) : null;
  const msProtocolOwner = method.owner || undefined;

  const { data: protocol } = useQuery({
    queryKey: ["mass-spec", msProtocolId, msProtocolOwner],
    queryFn: () => massSpecApi.get(msProtocolId!, msProtocolOwner),
    enabled: msProtocolId !== null,
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
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-body font-medium text-gray-700">
              {method.name || "Mass spec method"}
            </span>
            <span className="text-meta px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded">MS</span>
          </div>
          <span className="text-meta text-gray-400">
            Static template — edit on the /methods page
          </span>
        </div>

        {protocol ? (
          <MassSpecEditor
            ionizationMode={protocol.ionization_mode}
            ionizationLabel={protocol.ionization_label}
            instrument={protocol.instrument}
            description={protocol.description}
            source={protocol.source ?? {}}
            scan={protocol.scan ?? { is_msms: false }}
            calibration={protocol.calibration ?? {}}
            readOnly
            showAllFields={showAllFields}
            onShowAllFieldsChange={setShowAllFields}
          />
        ) : (
          <p className="text-body text-gray-400">No mass spec data available</p>
        )}
      </div>
    </div>
  );
}
