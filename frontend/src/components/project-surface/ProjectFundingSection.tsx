"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { purchasesApi, tasksApi } from "@/lib/local-api";
import {
  loadChargedGrants,
  type ChargedGrants,
} from "@/lib/funding/charged-grants";
import { defaultFundingStringForProject } from "@/lib/funding/prefill";
import type { FundingAccount, Project } from "@/lib/types";

/**
 * Project funding section (funding-niceties bot, 2026-05-28).
 *
 * Two complementary views of a project's grants:
 *
 *   - PRIMARY grant link: the single, stored `Project.funding_account_id`
 *     (set in the Edit project modal). This is the project's declared funding
 *     source.
 *
 *   - GRANTS CHARGED: the DERIVED, distinct set of grants that purchases
 *     inside the project were actually charged to (computed live from
 *     PurchaseItem.funding_string, never stored). This can differ from the
 *     primary link, which is the whole point: it surfaces where the money
 *     really went so a NIH data-management / grant report is accurate.
 *
 * The section is read-only and self-contained: it only renders when there is
 * something to show (a primary link OR at least one charged grant / unmatched
 * string), so an unfunded project's Overview stays clean.
 */

interface ProjectFundingSectionProps {
  project: Project;
}

// A subtle "link" icon, custom inline SVG (no icon library; project convention
// is hand-rolled SVGs). Used to mark the primary grant row.
function LinkIcon() {
  return (
    <svg
      className="w-4 h-4 text-blue-500 flex-shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 11-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 115.656 5.656l-1.5 1.5"
      />
    </svg>
  );
}

// A small "receipt" icon for the charged-grants rows, visually distinct from
// the primary link icon.
function ReceiptIcon() {
  return (
    <svg
      className="w-4 h-4 text-gray-400 flex-shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21l-7-3-7 3V5a2 2 0 012-2h10a2 2 0 012 2v16z"
      />
    </svg>
  );
}

export default function ProjectFundingSection({ project }: ProjectFundingSectionProps) {
  // Owner-routing mirrors the other project-surface sections: a receiver of a
  // shared project reads tasks (and the per-task purchases) from the owner's
  // directory. Funding accounts are always the current viewer's lab folder.
  const owner = project.is_shared_with_me ? project.owner : undefined;

  const { data: fundingAccounts = [] } = useQuery<FundingAccount[]>({
    queryKey: ["funding-accounts"],
    queryFn: () => purchasesApi.listFundingAccounts(),
  });

  const { data: charged } = useQuery<ChargedGrants>({
    queryKey: [
      "project-charged-grants",
      project.is_shared_with_me ? `${project.owner}:${project.id}` : `self:${project.id}`,
    ],
    queryFn: () =>
      loadChargedGrants(
        project.id,
        {
          listTasksByProject: tasksApi.listByProject,
          listPurchasesByTask: purchasesApi.listByTask,
          listFundingAccounts: purchasesApi.listFundingAccounts,
        },
        owner,
      ),
  });

  // The primary grant's name, resolved from the stored id. null when the
  // project is unlinked or its grant was deleted.
  const primaryName = useMemo(
    () => defaultFundingStringForProject(project.funding_account_id, fundingAccounts),
    [project.funding_account_id, fundingAccounts],
  );

  const accounts = charged?.accounts ?? [];
  const unmatched = charged?.unmatchedStrings ?? [];

  // Nothing to show: no primary link, no charged grants, no unmatched strings.
  // Keep the Overview uncluttered for unfunded projects.
  if (!primaryName && accounts.length === 0 && unmatched.length === 0) {
    return null;
  }

  return (
    <section className="border border-gray-200 rounded-lg p-4">
      <h3 className="text-body font-semibold text-gray-900 mb-3">Funding</h3>

      {/* Primary grant link: the single stored funding_account_id. */}
      <div className="mb-3">
        <p className="text-meta font-medium text-gray-500 mb-1">Primary grant</p>
        {primaryName ? (
          <div className="flex items-center gap-2">
            <LinkIcon />
            <span className="text-body text-gray-800">{primaryName}</span>
          </div>
        ) : (
          <p className="text-body text-gray-400">
            No primary grant linked. Set one in Edit project.
          </p>
        )}
      </div>

      {/* Derived charged-grants set: distinct from the single primary link. */}
      {(accounts.length > 0 || unmatched.length > 0) && (
        <div>
          <p className="text-meta font-medium text-gray-500 mb-1">
            Grants charged in this project
          </p>
          <ul className="flex flex-col gap-1">
            {accounts.map((acc) => (
              <li key={acc.id} className="flex items-center gap-2">
                <ReceiptIcon />
                <span className="text-body text-gray-800">{acc.name}</span>
                {acc.award_number ? (
                  <span className="text-meta text-gray-400">({acc.award_number})</span>
                ) : null}
              </li>
            ))}
            {unmatched.map((value) => (
              <li key={`unmatched:${value}`} className="flex items-center gap-2">
                <ReceiptIcon />
                <span className="text-body text-gray-800">{value}</span>
                <span className="text-meta text-amber-600">(no matching account)</span>
              </li>
            ))}
          </ul>
          <p className="text-meta text-gray-400 mt-2">
            Derived from the funding lines on this project&apos;s purchases. This
            can differ from the primary grant.
          </p>
        </div>
      )}
    </section>
  );
}
