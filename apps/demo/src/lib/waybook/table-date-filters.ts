import { fromZonedTime } from "date-fns-tz";
import type { tenantDb } from "./database";
import { tenantDayBounds } from "./today-command-centre";

export type TableDateParams = { sort?: string; from?: string; to?: string };
export const tableDateSorts = [
  { value: "today", label: "Today first" },
  { value: "oldest", label: "Oldest first" },
  { value: "newest", label: "Newest first" },
] as const;

type Database = ReturnType<typeof tenantDb>;
type DateSort = (typeof tableDateSorts)[number]["value"];

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return;
  const date = new Date(value + "T00:00:00Z");
  if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return value;
}

export function tableDateFilters(params: TableDateParams, timezone: string, now = new Date()) {
  const sort = tableDateSorts.find(option => option.value === params.sort)?.value ?? "today";
  const from = validDate(params.from);
  const to = validDate(params.to);
  const toDate = to && new Date(to + "T12:00:00Z");
  if (toDate) toDate.setUTCDate(toDate.getUTCDate() + 1);
  const day = tenantDayBounds(now, timezone);
  return {
    sort, from, to,
    start: from ? fromZonedTime(from + "T00:00:00", timezone) : null,
    end: toDate && to !== "9999-12-31" ? fromZonedTime(toDate.toISOString().slice(0, 10) + "T00:00:00", timezone) : null,
    today: day.start,
    todayKey: day.localDate,
  };
}

export type TableDateFilters = ReturnType<typeof tableDateFilters>;

export function hasTableDateFilters({ sort, from, to }: TableDateFilters) {
  return sort !== "today" || Boolean(from || to);
}

export function dateFilterParams(params: URLSearchParams, filters: TableDateFilters) {
  if (filters.sort !== "today") params.set("sort", filters.sort);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params;
}

export function dateRangeWhere(db: Database, column: string, filters: TableDateFilters, dateOnly = false) {
  if (dateOnly) return db`
    ${filters.from ? db`AND ${db(column)} >= ${filters.from}::date` : db``}
    ${filters.to ? db`AND ${db(column)} <= ${filters.to}::date` : db``}
  `;
  return db`
    ${filters.start ? db`AND ${db(column)} >= ${filters.start}` : db``}
    ${filters.end ? db`AND ${db(column)} < ${filters.end}` : db``}
  `;
}

export function tableDateOrder(db: Database, column: string, tieBreaker: string, { sort, today }: { sort: DateSort; today: Date | string }, dateOnly = false) {
  const date = db(column);
  const tie = db(tieBreaker);
  if (sort === "oldest") return db`${date} ASC NULLS LAST, ${tie} ASC`;
  if (sort === "newest") return db`${date} DESC NULLS LAST, ${tie} DESC`;
  const boundary = dateOnly ? db`${today}::date` : db`${today}`;
  return db`
    CASE WHEN ${date} >= ${boundary} THEN 0 WHEN ${date} IS NOT NULL THEN 1 ELSE 2 END,
    CASE WHEN ${date} >= ${boundary} THEN ${date} END ASC,
    CASE WHEN ${date} < ${boundary} THEN ${date} END DESC,
    ${tie} ASC
  `;
}
