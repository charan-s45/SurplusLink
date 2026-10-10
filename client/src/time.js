// Display helpers for "YYYY-MM-DDTHH:MM" strings. These only format the
// simulated clock's values; the app never looks at the browser's real time.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(value) {
  const [date, time] = value.split('T');
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d, time };
}

export function formatDay(value) {
  const { y, m, d } = parts(value);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[weekday]} ${d} ${MONTHS[m - 1]}`;
}

export function formatTime(value) {
  return parts(value).time;
}

/** "18:00 – 20:00", adding the day only when the window crosses midnight. */
export function formatWindow(from, until) {
  if (from.slice(0, 10) === until.slice(0, 10)) return `${formatTime(from)} – ${formatTime(until)}`;
  return `${formatTime(from)} – ${formatDay(until)} ${formatTime(until)}`;
}

export function addMinutes(value, minutes) {
  const { y, m, d, time } = parts(value);
  const [hh, mm] = time.split(':').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d, hh, mm + minutes));
  const pad = (n) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

export function later(a, b) {
  return a > b ? a : b;
}
