type Props = {
  startName: string;
  endName: string;
  startLabel?: string;
  endLabel?: string;
  optional?: boolean;
  defaultStart?: string;
  defaultEnd?: string;
};

/** Shared accessible 30-minute operational range fields. Server actions remain
 * authoritative for ordering and overlap validation. */
export function TimeRangeInputs({ startName, endName, startLabel = "From", endLabel = "Until", optional = false, defaultStart, defaultEnd }: Props) {
  return <div className="tenant-drawer-form__grid" role="group" aria-label="Time range">
    <label>{startLabel}<input name={startName} type="time" step="1800" defaultValue={defaultStart} required={!optional} /></label>
    <label>{endLabel}<input name={endName} type="time" step="1800" defaultValue={defaultEnd} required={!optional} /></label>
  </div>;
}
