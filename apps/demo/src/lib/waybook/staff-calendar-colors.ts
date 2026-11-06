/**
 * The calendar needs a small, predictable palette: these tones retain their
 * distinction on the neutral card surface in both appearance modes.
 */
export const staffCalendarColors = [
  { value: "#67c7cf", label: "Teal" },
  { value: "#5fc4cd", label: "Aqua" },
  { value: "#7baaf7", label: "Blue" },
  { value: "#a78bfa", label: "Lilac" },
  { value: "#db8cb0", label: "Rose" },
  { value: "#f59e8b", label: "Peach" },
  { value: "#f0b86e", label: "Honey" },
  { value: "#84cc98", label: "Mint" },
] as const;

export const defaultStaffCalendarColor = staffCalendarColors[0].value;
export const staffCalendarColorValues = new Set<string>(staffCalendarColors.map(({ value }) => value));
