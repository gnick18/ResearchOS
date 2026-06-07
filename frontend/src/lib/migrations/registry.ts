// The ordered migration registry. Each entry wraps an existing, idempotent
// repair function (the ones that were manual "Run repair" buttons) and maps its
// report onto the uniform MigrationReport. Order matters where one depends on
// another; add new migrations at the END with a fresh `-vN` id.

import { tasksApi, methodsApi } from "@/lib/local-api";
import { repairStampFormats } from "@/lib/tasks/migrate-stamps";
import type { Migration } from "./types";

export const MIGRATIONS: Migration[] = [
  {
    id: "method-source-paths-v1",
    title: "Method source paths",
    run: async () => {
      const r = await methodsApi.repairSourcePaths();
      return { changed: r.repaired, scanned: r.scanned, failed: r.failed };
    },
  },
  {
    id: "method-links-v1",
    title: "Method links",
    run: async () => {
      const r = await tasksApi.repairMethodLinks();
      return { changed: r.repaired, scanned: r.scanned, failed: r.failed };
    },
  },
  {
    id: "stamp-formats-v1",
    title: "Stamp formats",
    run: async () => {
      const r = await repairStampFormats();
      return { changed: r.repaired, scanned: r.scanned, failed: 0 };
    },
  },
];
