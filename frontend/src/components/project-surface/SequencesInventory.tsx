"use client";

import Link from "@/components/FixtureLink";
import { useQuery } from "@tanstack/react-query";
import { sequencesApi } from "@/lib/local-api";
import type { Project, SeqType, SequenceRecord } from "@/lib/types";

interface SequencesInventoryProps {
  project: Project;
}

// PRESENTATION-ONLY (de-bloat arc, Phase 3b). This section reads the sequence
// arc's live `sequencesApi.listByProject` (lib/local-api.ts) and renders the
// plasmids/sequences linked to this project as a clean read-only list. It does
// NOT embed or rebuild the SeqViz editor/viewer and writes no sequence data:
// every row links OUT to the `/sequences` library (owned by the sequence arc).
// The `/sequences` route selects sequences via internal state only (no focus
// query param today), so rows link to the bare route.
const SEQUENCES_ROUTE = "/sequences";

function seqTypeLabel(t: SeqType): string {
  return t === "protein" ? "Protein" : t === "rna" ? "RNA" : "DNA";
}

export default function SequencesInventory({ project }: SequencesInventoryProps) {
  // Shares the EXACT query key used by useSectionPresence in ProjectRoute so the
  // tab-visibility probe and this section read from one warmed cache entry
  // (no double disk scan). `listByProject` filters the current user's library
  // by `project_ids` membership and returns light summary records (no bases).
  const { data: sequences = [], isLoading } = useQuery<SequenceRecord[]>({
    queryKey: ["project-sequences", project.owner, project.id],
    queryFn: () => sequencesApi.listByProject(project.id),
  });

  return (
    <section id="sequences" className="scroll-mt-32">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-gray-900">Sequences</h2>
        <Link
          href={SEQUENCES_ROUTE}
          className="text-xs text-gray-500 hover:text-gray-700 hover:underline whitespace-nowrap"
        >
          Manage in the sequence library →
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 italic">Loading sequences…</p>
      ) : sequences.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          No sequences linked yet. Plasmids and sequences linked to this project
          in the sequence library will appear here.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden bg-white">
          {sequences.map((seq) => (
            <Link
              key={seq.id}
              href={SEQUENCES_ROUTE}
              className="px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors"
            >
              <span className="text-sm font-medium text-gray-800 truncate flex-1 min-w-0">
                {seq.display_name}
              </span>
              <span className="text-[11px] text-gray-400 flex-shrink-0">
                {seq.length.toLocaleString()} bp
              </span>
              <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full flex-shrink-0">
                {seqTypeLabel(seq.seq_type)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
