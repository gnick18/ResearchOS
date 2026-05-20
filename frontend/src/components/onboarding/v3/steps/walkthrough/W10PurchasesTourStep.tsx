import { useEffect, useState } from "react";
import { purchasesApi, tasksApi } from "@/lib/local-api";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "./lib/SpeechBubble";
import {
  appendArtifact,
  findArtifact,
} from "./lib/wizard-artifacts";

/**
 * W10: Purchases tour (conditional walkthrough).
 *
 * Fires only when `feature_picks.purchases === "yes"` (gated by the
 * state machine; the step body assumes the user opted in and shows the
 * full flow).
 *
 * BeakerBot walks the user through creating a purchase request on the
 * Purchases tab. We mirror the request inside the wizard so the user
 * doesn't navigate away (the L11 pacing lock + W5 in-wizard fallback
 * pattern). The "approve + receive" affordance is two checkboxes inside
 * the wizard that flip the underlying purchase task's `is_complete`
 * state via `tasksApi.update`. Real flow uses a richer status model
 * (requested / ordered / received) on the Purchases page; the wizard
 * collapses that into a single approve-and-receive step.
 *
 * Artifact: `{ type: "purchase", id: <task-id>, cleanup_default: "keep" }`.
 * The artifact id is the parent task id since purchases are task-backed
 * (`task_type: "purchase"`); the line item lives inside it and is
 * cleaned up implicitly when the parent task is deleted.
 *
 * Next is gated until the purchase exists. Skip-this-step is handled by
 * the shell. W10 has no downstream dependents in the v3 walkthrough so
 * no auto-prerequisite is needed.
 */

interface W10Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

const DEFAULT_PURCHASE_NAME = "Sample reagent order";
const DEFAULT_ITEM_NAME = "Sample reagent";
const DEFAULT_PRICE = 50;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function W10PurchasesTourStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: W10Props) {
  const existing = findArtifact(sidecar, "purchase");
  const projectArtifact = findArtifact(sidecar, "project");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [received, setReceived] = useState(false);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    setNextDisabled(existing === null);
  }, [existing, setNextDisabled]);

  const handleCreate = async () => {
    if (creating || existing) return;
    setCreating(true);
    setError(null);
    try {
      const purchaseTask = await tasksApi.create({
        project_id: projectArtifact ? Number(projectArtifact.id) : null,
        name: DEFAULT_PURCHASE_NAME,
        start_date: todayLocal(),
        duration_days: 1,
        task_type: "purchase",
      });
      await purchasesApi.create({
        task_id: purchaseTask.id,
        item_name: DEFAULT_ITEM_NAME,
        quantity: 1,
        price_per_unit: DEFAULT_PRICE,
      });
      await patchSidecar((cur) =>
        appendArtifact(cur, {
          type: "purchase",
          id: String(purchaseTask.id),
          cleanup_default: "keep",
        }),
      );
    } catch (err) {
      console.error("[onboarding-v3] W10 purchase create failed", err);
      setError("Couldn't create the sample purchase. Try again or skip this step.");
    } finally {
      setCreating(false);
    }
  };

  const handleReceived = async () => {
    if (!existing || marking || received) return;
    setMarking(true);
    try {
      await tasksApi.update(Number(existing.id), { is_complete: true });
      setApproved(true);
      setReceived(true);
    } catch (err) {
      console.warn("[onboarding-v3] W10 mark-received failed", err);
    } finally {
      setMarking(false);
    }
  };

  return (
    <div data-step-id="W10" className="space-y-4">
      <SpeechBubble>
        You said yes to tracking lab purchases, so here&apos;s the quick
        version. I&apos;ll create a sample request for you, then show how
        you mark it approved and received. The real Purchases tab handles
        funding accounts, vendors, the works.
      </SpeechBubble>

      {existing ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Sample request created: {DEFAULT_PURCHASE_NAME} (${DEFAULT_PRICE}).
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300"
              />
              <span>Approve the request</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={received}
                onChange={(e) => {
                  if (e.target.checked) void handleReceived();
                  else setReceived(false);
                }}
                disabled={!approved || marking}
                className="w-4 h-4 rounded border-gray-300 disabled:opacity-50"
                data-w10-received
              />
              <span className={approved ? "" : "text-gray-400"}>
                Mark it received
              </span>
            </label>
            {received && (
              <p className="text-xs text-emerald-700 pt-1">
                The Purchases tab tracks the line items, the totals roll up
                into your funding account, and the experiment timeline picks
                up the linked task.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="w-full px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create a sample purchase"}
          </button>
          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
