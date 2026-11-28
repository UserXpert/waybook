import { tableDateSorts, type TableDateFilters } from "@/lib/waybook/table-date-filters";

import { TableDateRange } from "./table-date-range";

export function TableDateFields({ dates, label, withSort = true }: {
  dates: TableDateFilters;
  label: string;
  withSort?: boolean;
}) {
  return <>
    {withSort ? <label>Sort by<select name="sort" defaultValue={dates.sort}>
      {tableDateSorts.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
    </select></label> : null}
    <TableDateRange label={label} today={dates.todayKey} initialFrom={dates.from} initialTo={dates.to} />
  </>;
}
