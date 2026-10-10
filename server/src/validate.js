// Shape checks for request bodies. These run before any business rule, so a
// request with "kg": 2.5 gets a 400 INVALID_INPUT, never a rule violation.

import { invalidInput } from './errors.js';
import { isValidTime } from './time.js';

const TIME_HINT = 'must be a valid time in the form YYYY-MM-DDTHH:MM';

export function check(body, spec) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const details = [];
  for (const [field, kind] of Object.entries(spec)) {
    const problem = PROBLEMS[kind](source[field]);
    if (problem) details.push({ field, message: `${field} ${problem}` });
  }
  if (details.length) throw invalidInput(details);
  return source;
}

const PROBLEMS = {
  id: (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'is required'),
  text: (v) => {
    if (typeof v !== 'string' || v.trim() === '') return 'must not be empty';
    if (v.trim().length > 200) return 'must be 200 characters or fewer';
    return null;
  },
  kg: (v) => (Number.isSafeInteger(v) && v >= 1 ? null : 'must be a whole number of kilograms, at least 1'),
  time: (v) => (isValidTime(v) ? null : TIME_HINT),
};
