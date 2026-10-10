// Every expected failure is thrown as an AppError and turned into JSON by the
// error middleware in app.js. Unexpected errors become a plain 500.

export class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

/** Malformed input: wrong types, bad formats, missing fields. HTTP 400. */
export function invalidInput(details) {
  return new AppError(400, 'INVALID_INPUT', 'Some fields are missing or invalid.', { details });
}

export function notFound(kind, id) {
  return new AppError(404, 'NOT_FOUND', `${kind} "${id}" does not exist.`);
}

export function forbidden(message) {
  return new AppError(403, 'FORBIDDEN', message);
}

/** Well-formed request that breaks a business rule. HTTP 422. */
export function ruleViolation(message, violations) {
  return new AppError(422, 'RULE_VIOLATION', message, { violations });
}
