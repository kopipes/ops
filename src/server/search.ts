import { or, sql, type AnyColumn } from "drizzle-orm";

export const normalizeSearch = (query?: unknown) => typeof query === "string" ? query.trim().slice(0, 120) : "";

/** Literal substring search: %, _ and quotes are data, never SQL wildcards. */
export function textSearch(query: string | undefined, ...columns: AnyColumn[]) {
  const needle = normalizeSearch(query).toLowerCase();
  return needle ? or(...columns.map(column => sql`instr(lower(coalesce(${column}, '')), ${needle}) > 0`)) : undefined;
}
