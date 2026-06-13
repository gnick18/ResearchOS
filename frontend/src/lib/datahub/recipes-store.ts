/**
 * datahub/recipes-store.ts
 *
 * Saved ANALYSIS RECIPES for the Data Hub. A recipe captures the REUSABLE part
 * of an analysis (its engine type plus its Test-options params) so a researcher
 * can configure a test once, name it, and re-run the same test with the same
 * options on any other table of the matching kind. A recipe deliberately does
 * NOT capture the table-specific inputs (column ids) or the cached result, only
 * the analysis type, its params bag, and which table TYPE it applies to, so the
 * New analysis picker can show only the recipes that fit the open table.
 *
 * Storage follows the existing per-user single-file pattern (see
 * lib/calendar/external-feeds-store.ts and the _calendar-feeds.json store). The
 * recipes for one owner live in ONE JSON file at
 * users/<owner>/datahub/_recipes.json, read and written through fileService.
 * Ids are minted from a monotonically increasing nextId counter held in the
 * same file (never Date.now / Math.random, which the shared code forbids and
 * which would recycle ids across deletes), stringified, so a recipe id is a
 * stable per-user string.
 *
 * This store is ADDITIVE. It introduces no change to any existing Data Hub
 * on-disk shape; the recipes file is a new sibling file under the datahub dir.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { fileService } from "../file-system/file-service";
import { getCurrentUserCached } from "../storage/json-store";
import { dataHubDir } from "../loro/datahub-sidecar-store";
import type { DataHubTableType } from "./model/types";

const SCHEMA_VERSION = 1;

/**
 * A saved analysis recipe. analysisType is the engine identifier (the same
 * string AnalysisSpec.type carries, e.g. "unpairedTTest"); params is the
 * Test-options bag the analysis re-runs with (tails, post-hoc family, alpha,
 * reference group, etc.); tableType is the table archetype the recipe applies
 * to, derived from the table it was saved on, so the picker filters by fit.
 */
export interface AnalysisRecipe {
  id: string;
  name: string;
  analysisType: string;
  params: Record<string, unknown>;
  tableType: DataHubTableType;
  created_at: string;
}

/** The on-disk file shape for one owner's recipes. */
interface RecipesFile {
  version: number;
  recipes: AnalysisRecipe[];
  /** Monotonically increasing id source, so a delete never recycles an id. */
  nextId: number;
}

/** The create payload (id + created_at are minted by the store). */
export interface RecipeCreate {
  name: string;
  analysisType: string;
  params: Record<string, unknown>;
  tableType: DataHubTableType;
}

function recipesPath(owner: string): string {
  return `${dataHubDir(owner)}/_recipes.json`;
}

/**
 * Per-owner write queue serializes read-modify-write operations on each
 * _recipes.json so concurrent callers do not race the atomic-write pattern
 * (.tmp create + write + move). Mirrors the queue in external-feeds-store.ts.
 */
const recipesWriteQueues = new Map<string, Promise<unknown>>();
function enqueueRecipesWrite<T>(owner: string, fn: () => Promise<T>): Promise<T> {
  const prev = recipesWriteQueues.get(owner) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  recipesWriteQueues.set(
    owner,
    next.catch(() => {}),
  );
  return next;
}

async function readFile(owner: string): Promise<RecipesFile> {
  const data = await fileService.readJson<RecipesFile>(recipesPath(owner));
  if (!data || !Array.isArray(data.recipes)) {
    return { version: SCHEMA_VERSION, recipes: [], nextId: 1 };
  }
  return {
    version: SCHEMA_VERSION,
    recipes: data.recipes,
    nextId: typeof data.nextId === "number" ? data.nextId : data.recipes.length + 1,
  };
}

async function writeFile(owner: string, data: RecipesFile): Promise<void> {
  await fileService.ensureDir(dataHubDir(owner));
  await fileService.writeJson(recipesPath(owner), data);
}

function sortByCreated(a: AnalysisRecipe, b: AnalysisRecipe): number {
  // Newest first, falling back to id so the order is stable.
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

export const recipesApi = {
  /** List the current user's saved recipes, newest first. */
  async list(): Promise<AnalysisRecipe[]> {
    const owner = await getCurrentUserCached();
    const file = await readFile(owner);
    return [...file.recipes].sort(sortByCreated);
  },

  /** Save a new recipe for the current user, minting a fresh id. */
  async create(data: RecipeCreate): Promise<AnalysisRecipe> {
    const owner = await getCurrentUserCached();
    return enqueueRecipesWrite(owner, async () => {
      const file = await readFile(owner);
      const recipe: AnalysisRecipe = {
        id: String(file.nextId),
        name: data.name,
        analysisType: data.analysisType,
        params: data.params,
        tableType: data.tableType,
        created_at: new Date().toISOString(),
      };
      await writeFile(owner, {
        version: SCHEMA_VERSION,
        recipes: [...file.recipes, recipe],
        nextId: file.nextId + 1,
      });
      return recipe;
    });
  },

  /** Rename a recipe by id. Returns the updated recipe, or null when missing. */
  async rename(id: string, name: string): Promise<AnalysisRecipe | null> {
    const owner = await getCurrentUserCached();
    return enqueueRecipesWrite(owner, async () => {
      const file = await readFile(owner);
      const idx = file.recipes.findIndex((r) => r.id === id);
      if (idx === -1) return null;
      const next: AnalysisRecipe = { ...file.recipes[idx], name };
      const recipes = [...file.recipes];
      recipes[idx] = next;
      await writeFile(owner, { ...file, recipes });
      return next;
    });
  },

  /** Delete a recipe by id. Returns true when it existed. */
  async remove(id: string): Promise<boolean> {
    const owner = await getCurrentUserCached();
    return enqueueRecipesWrite(owner, async () => {
      const file = await readFile(owner);
      const filtered = file.recipes.filter((r) => r.id !== id);
      if (filtered.length === file.recipes.length) return false;
      await writeFile(owner, { ...file, recipes: filtered });
      return true;
    });
  },
};
