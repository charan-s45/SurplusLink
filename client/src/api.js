// Thin wrapper around fetch. Every call goes to the Express API under /api;
// in development Vite forwards those requests to port 4000.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? 'The server could not complete the request.');
    this.status = status;
    this.code = body?.error?.code ?? 'UNKNOWN';
    this.violations = body?.error?.violations ?? [];
    this.details = body?.error?.details ?? [];
  }

  /** Every individual reason, ready to list in the UI. */
  get reasons() {
    if (this.violations.length) return this.violations.map((v) => ({ key: v.code, rule: v.rule, text: v.message }));
    if (this.details.length) return this.details.map((d) => ({ key: d.field, text: d.message }));
    return [{ key: this.code, text: this.message }];
  }
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: { code: 'OFFLINE', message: 'Cannot reach the server. Is the backend running?' } });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  bootstrap: () => call('GET', '/bootstrap'),
  dashboard: () => call('GET', '/dashboard'),
  allDonations: () => call('GET', '/donations'),
  donorDonations: (donorId) => call('GET', `/donations?donor_id=${encodeURIComponent(donorId)}`),
  availableDonations: (volunteerId) => call('GET', `/donations?available_for=${encodeURIComponent(volunteerId)}`),
  volunteerClaims: (volunteerId) => call('GET', `/claims?volunteer_id=${encodeURIComponent(volunteerId)}`),

  setClock: (now) => call('PUT', '/clock', { now }),
  postDonation: (fields) => call('POST', '/donations', fields),
  cancelDonation: (id, donorId) => call('POST', `/donations/${id}/cancel`, { donor_id: donorId }),
  claim: (donationId, fields) => call('POST', `/donations/${donationId}/claims`, fields),
  collectClaim: (id, volunteerId) => call('POST', `/claims/${id}/collect`, { volunteer_id: volunteerId }),
  cancelClaim: (id, volunteerId) => call('POST', `/claims/${id}/cancel`, { volunteer_id: volunteerId }),
};
