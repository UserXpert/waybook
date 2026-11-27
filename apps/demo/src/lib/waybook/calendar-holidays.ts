export const calendarHolidayRegions = { DK: "Denmark" } as const;
export type CalendarHolidayRegion = keyof typeof calendarHolidayRegions;

function easterSunday(year: number) {
  // Oudin's Gregorian computus. https://aa.usno.navy.mil/faq/easter
  const lunarCycle = year % 19;
  const century = Math.floor(year / 100);
  const leapCenturies = Math.floor(century / 4);
  const epact = (century - leapCenturies - Math.floor((8 * century + 13) / 25) + 19 * lunarCycle + 15) % 30;
  const correction = Math.floor(epact / 28);
  const paschalMoon = epact - correction * (1 - correction * Math.floor(29 / (epact + 1)) * Math.floor((21 - lunarCycle) / 11));
  const weekday = (year + Math.floor(year / 4) + paschalMoon + 2 - century + leapCenturies) % 7;
  const days = paschalMoon - weekday;
  const month = 3 + Math.floor((days + 40) / 44);
  return Date.UTC(year, month - 1, days + 28 - 31 * Math.floor(month / 4));
}

export function calendarHolidays(region: CalendarHolidayRegion | null, dates: string[]) {
  const holidays = new Map<string, string>();
  if (region !== "DK") return holidays;

  for (const year of new Set(dates.map((date) => Number(date.slice(0, 4))))) {
    holidays.set(`${year}-01-01`, "New Year’s Day");
    holidays.set(`${year}-12-25`, "Christmas Day");
    holidays.set(`${year}-12-26`, "Boxing Day");

    const easter = easterSunday(year);
    const movable = [
      [-3, "Maundy Thursday"], [-2, "Good Friday"], [0, "Easter Sunday"],
      [1, "Easter Monday"], [39, "Ascension Day"], [49, "Whit Sunday"], [50, "Whit Monday"],
    ] as const;
    for (const [days, name] of movable) {
      holidays.set(new Date(easter + days * 86_400_000).toISOString().slice(0, 10), name);
    }
    // Great Prayer Day ceased to be a public holiday in 2024.
    if (year < 2024) holidays.set(new Date(easter + 26 * 86_400_000).toISOString().slice(0, 10), "Great Prayer Day");
  }
  return holidays;
}
