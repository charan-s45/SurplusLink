// All times in SurplusLink are local wall-clock strings: "YYYY-MM-DDTHH:MM".
// There are no time zones, so we convert each string to a plain number of
// minutes and compare numbers. Date.UTC is used only as a calendar calculator;
// nothing here reads the computer's current time.

const TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Returns minutes since the epoch, or null when the value is not a valid time. */
export function toMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;

  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59) return null;

  return Date.UTC(year, month - 1, day, hour, minute) / 60000;
}

export function isValidTime(value) {
  return toMinutes(value) !== null;
}

/** Negative when a is earlier than b, zero when equal, positive when later. */
export function compareTimes(a, b) {
  return toMinutes(a) - toMinutes(b);
}

export function minutesBetween(a, b) {
  return Math.abs(toMinutes(a) - toMinutes(b));
}

export function isWithin(value, from, until) {
  return compareTimes(value, from) >= 0 && compareTimes(value, until) <= 0;
}

export function addMinutes(value, minutes) {
  const d = new Date((toMinutes(value) + minutes) * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
