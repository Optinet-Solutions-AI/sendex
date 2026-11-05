import { isListSortKey, type ListSortKey, type SortDirection } from "@sendex/core";

/** Query-string state of the lists table: `/lists?search=roy&country=ES&sort=name&dir=asc&page=2`. */
export interface ListsQuery {
  search: string;
  country: string;
  sort: ListSortKey;
  dir: SortDirection;
  page: number;
}

export const LISTS_PAGE_SIZE = 50;

export type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Parse the URL search params with safe defaults; unknown sort keys fall back to created date. */
export function parseListsQuery(params: SearchParams): ListsQuery {
  const sortRaw = first(params.sort);
  const sort = isListSortKey(sortRaw) ? sortRaw : "createdAt";
  const dirRaw = first(params.dir);
  const dir: SortDirection = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : "desc";
  const pageRaw = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  return {
    search: first(params.search).trim(),
    country: first(params.country).trim().toUpperCase(),
    sort,
    dir,
    page,
  };
}

/** Build the query string for a state, leaving defaults out so the URL stays short. */
export function listsQueryString(query: Partial<ListsQuery>): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.country) params.set("country", query.country);
  if (query.sort && query.sort !== "createdAt") params.set("sort", query.sort);
  if (query.dir && query.dir !== "desc") params.set("dir", query.dir);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}
