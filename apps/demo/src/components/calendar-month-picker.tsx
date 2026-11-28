import { ChevronLeft, ChevronRight } from "lucide-react";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const months = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2020, month, 1))));
export const parsePickerDate = (value: string) => new Date(`${value}T12:00:00Z`);
const keyOf = (date: Date) => date.toISOString().slice(0, 10);

const dayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function CalendarMonthPicker({ visibleMonth, referenceYear, from, to, onMonthChange, onSelect }: {
  visibleMonth: Date;
  referenceYear: number;
  from?: string;
  to?: string;
  onMonthChange: (month: Date) => void;
  onSelect: (date: string) => void;
}) {
  const year = visibleMonth.getUTCFullYear();
  const month = visibleMonth.getUTCMonth();
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstYear = Math.max(1000, Math.min(year, referenceYear - 100));
  const lastYear = Math.min(9999, Math.max(year, referenceYear + 100));
  const move = (nextYear: number, nextMonth: number) => onMonthChange(new Date(Date.UTC(nextYear, nextMonth, 1, 12)));

  return <>
    <span className="calendar-date-picker__navigation">
      <button type="button" aria-label="Previous picker month" disabled={year === 1000 && month === 0}
        onClick={() => move(year, month - 1)}><ChevronLeft size={17} aria-hidden="true" /></button>
      <label><span className="calendar-date-picker__sr-only">Month</span><select aria-label="Month" value={month} onChange={(event) => move(year, Number(event.target.value))}>
        {months.map((name, index) => <option value={index} key={name}>{name}</option>)}
      </select></label>
      <label><span className="calendar-date-picker__sr-only">Year</span><select aria-label="Year" value={year} onChange={(event) => move(Number(event.target.value), month)}>
        {Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index).map((value) => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <button type="button" aria-label="Next picker month" disabled={year === 9999 && month === 11}
        onClick={() => move(year, month + 1)}><ChevronRight size={17} aria-hidden="true" /></button>
    </span>
    <span className="calendar-date-picker__weekdays" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</span>
    <span className="calendar-date-picker__grid">
      {Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} />)}
      {Array.from({ length: dayCount }, (_, index) => {
        const date = new Date(Date.UTC(year, month, index + 1, 12));
        const value = keyOf(date);
        const endpoint = value === from || value === to;
        const inRange = from && to && value > from && value < to;
        return <button type="button" key={value} aria-label={dayLabel.format(date)} aria-pressed={Boolean(endpoint || inRange)}
          className={endpoint ? "is-selected" : inRange ? "is-in-range" : undefined} onClick={() => onSelect(value)}>{index + 1}</button>;
      })}
    </span>
  </>;
}
