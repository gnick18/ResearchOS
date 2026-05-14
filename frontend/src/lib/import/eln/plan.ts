import type {
  ELNImportPlan,
  ELNProjectMapping,
  ParsedNotebook,
  ParsedPage,
} from "./types";

/**
 * Strip notebook chrome from a page's tree path. Removes:
 *  - The notebook name itself (e.g. "The FUNGI lab"), case-insensitive.
 *  - Any element in the export's `rootBreadcrumb` (e.g. "Notebooks", "postdocs").
 *  - A bare "Notebooks" element as a final safety net.
 *
 * What remains is the path of meaningful folders + the page name at the end.
 */
function cleanTreePath(
  treePath: string[],
  notebookName: string | null,
  rootBreadcrumb: string[],
): string[] {
  const nb = notebookName ? notebookName.toLowerCase() : null;
  const breadcrumb = new Set(rootBreadcrumb);
  return treePath.filter((segment) => {
    if (segment === "Notebooks") return false;
    if (breadcrumb.has(segment)) return false;
    if (nb !== null && segment.toLowerCase() === nb) return false;
    return true;
  });
}

/**
 * Derive the default project mapping for a page.
 *
 * Rules:
 *  - Strip notebook chrome from `treePath` (notebook name + rootBreadcrumb).
 *  - The LAST element of the cleaned path is the page name (becomes the task).
 *  - The FIRST element of the cleaned path is the project name candidate.
 *    This collapses deeper "Justin E / lab notes / page-name" paths under
 *    the same "Justin E" project that "Justin E / meetings" lives in.
 *  - When cleaned is empty, return `null` (orphan task).
 *  - When cleaned has exactly 1 element, the page sits at the export root
 *    with no folder context — use the page name as both project name and
 *    task name (the user can rename either).
 *
 * Why first-after-chrome rather than the brief's literal "second-to-last":
 * LabArchives notebooks file pages under per-person folders with category
 * subfolders ("meetings", "lab notes"). Second-to-last would map
 * "Justin E / lab notes / del_laeA" to a "lab notes" project, splitting it
 * away from "Justin E / meetings". Grouping by the person folder matches the
 * brief's stated expectation of 4 mappings (Sam O, Grant N, Justin E,
 * Daniel CG) for the 5-page sample.
 */
function deriveMappingForPage(
  page: ParsedPage,
  notebookName: string | null,
  rootBreadcrumb: string[],
): { key: string; defaultProjectName: string | null } {
  const cleaned = cleanTreePath(page.treePath, notebookName, rootBreadcrumb);
  if (cleaned.length === 0) {
    return {
      key: `__orphan__:${page.pageId}`,
      defaultProjectName: null,
    };
  }
  const projectName = cleaned[0];
  return {
    key: projectName,
    defaultProjectName: projectName,
  };
}

/**
 * Build the default import plan from a parsed notebook. Pure — no disk
 * reads or writes. The wizard UI edits `projectMappings` in place before
 * calling `applyELNImportPlan`.
 *
 * Mapping defaults:
 *  - Any page with a non-null derived project name starts at "import-new"
 *    with `newProjectName` pre-filled to the derived name.
 *  - Orphan pages (cleaned treePath is empty) start at "no-project"
 *    and each gets its own mapping row so the wizard can decide
 *    case-by-case.
 *
 * Pages sharing the same derived project name collapse into one mapping
 * with multiple `pageIds`.
 */
export function buildDefaultPlan(
  parsed: ParsedNotebook,
  receiver: string,
  startedAt: string,
): ELNImportPlan {
  const byKey = new Map<string, ELNProjectMapping>();

  for (const page of parsed.pages) {
    const { key, defaultProjectName } = deriveMappingForPage(
      page,
      parsed.notebookName,
      parsed.rootBreadcrumb,
    );

    const existing = byKey.get(key);
    if (existing) {
      existing.pageIds.push(page.pageId);
      continue;
    }

    if (defaultProjectName === null) {
      byKey.set(key, {
        treePathKey: key,
        defaultProjectName: null,
        decision: "no-project",
        pageIds: [page.pageId],
      });
    } else {
      byKey.set(key, {
        treePathKey: key,
        defaultProjectName,
        decision: "import-new",
        newProjectName: defaultProjectName,
        pageIds: [page.pageId],
      });
    }
  }

  return {
    source: "labarchives-offline-zip",
    parsed,
    projectMappings: Array.from(byKey.values()),
    receiver,
    startedAt,
  };
}
