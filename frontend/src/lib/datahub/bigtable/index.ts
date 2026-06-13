// datahub/bigtable/index.ts
//
// Public surface of the Data Hub large-dataset lane (DataHub-largetables lane,
// Increment 1). The DuckDB client is intentionally NOT re-exported here: it is
// client-only and importing this barrel from a server module must stay safe.
// Import duckdb-client.ts directly from a "use client" boundary.
//
// No em-dashes, no emojis, no mid-sentence colons.

export * from "./types";
export * from "./detection";
export * from "./dataset-store";
