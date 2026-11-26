import { tableDateSorts, type TableDateFilters } from "@/lib/waybook/table-date-filters";

export function TableDateFields({ dates, label, withSort = true }: {
  dates: TableDateFilters;
  label: string;
  withSort?: boolean;
}) {
  return <>
    {withSort ? <label>Sort by<select name="sort" defaultValue={dates.sort}>
      {tableDateSorts.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
    </select></label> : null}
    <fieldset className="table-date-range">
      <legend>{label}</legend>
      <label>From<input aria-label={`${label} from`} type="date" name="from" defaultValue={dates.from} /></label>
      <label>To<input aria-label={`${label} to`} type="date" name="to" defaultValue={dates.to} /></label>
    </fieldset>
  </>;
}
