// Figure page persistence. A FigurePage is a small plain-JSON document (no
// cell-level CRDT needed, unlike a Data Hub table), stored per-owner under
// users/<owner>/figures/<id>.json, with ids minted from _counters.json under the
// "figures" entity. Mirrors the dataHubApi storage pattern exactly so a figure id
// is a stable per-user string that never collides with other entities.
//
// The pure model + helpers live in figure-page.ts; this is only the I/O.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { type FigurePage, createFigurePage } from "@/lib/figure/figure-page";

const ENTITY = "figures";

const figuresDir = (owner: string): string => `users/${owner}/figures`;
const figurePath = (owner: string, id: string): string =>
  `users/${owner}/figures/${id}.json`;

/** Allocate the next figure-page id from the owner's shared id space. */
async function nextFigureId(owner: string): Promise<string> {
  const path = `users/${owner}/_counters.json`;
  const counters =
    (await fileService.readJson<Record<string, number>>(path)) ?? {};
  const current = (counters[ENTITY] || 0) + 1;
  counters[ENTITY] = current;
  await fileService.writeJson(path, counters);
  return String(current);
}

/** Create + persist a fresh, empty Figure page in a collection. */
export async function createFigurePageDoc(
  name: string,
  collectionId: string | null,
): Promise<FigurePage> {
  const owner = await getCurrentUserCached();
  const id = await nextFigureId(owner);
  const page = createFigurePage(id, name, collectionId);
  await fileService.writeJson(figurePath(owner, id), page);
  return page;
}

/** Persist a Figure page (called on every edit, the wizard's no-soft-lock path). */
export async function saveFigurePage(page: FigurePage): Promise<void> {
  const owner = await getCurrentUserCached();
  await fileService.writeJson(figurePath(owner, page.id), page);
}

/** Read one Figure page by id, or null when it does not exist. */
export async function readFigurePage(id: string): Promise<FigurePage | null> {
  const owner = await getCurrentUserCached();
  return (await fileService.readJson<FigurePage>(figurePath(owner, id))) ?? null;
}

/**
 * List the owner's Figure pages. Pass a collectionId to scope to one collection
 * (null = unfiled); omit it for every page. Reads only the small JSON docs.
 */
export async function listFigurePages(
  collectionId?: string | null,
): Promise<FigurePage[]> {
  const owner = await getCurrentUserCached();
  const files = await fileService.listFiles(figuresDir(owner));
  const out: FigurePage[] = [];
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    const page = await fileService.readJson<FigurePage>(
      `${figuresDir(owner)}/${name}`,
    );
    if (!page) continue;
    if (collectionId !== undefined && page.collectionId !== collectionId) continue;
    out.push(page);
  }
  return out;
}
