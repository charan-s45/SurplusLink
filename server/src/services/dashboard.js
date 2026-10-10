import { buildDashboard } from '../rules.js';
import { getClock, listClaimRows, listDonations, listDonors, listVolunteers } from '../store.js';

export function getDashboard(db) {
  return {
    now: getClock(db),
    ...buildDashboard({
      donations: listDonations(db),
      claims: listClaimRows(db),
      donors: listDonors(db),
      volunteers: listVolunteers(db),
    }),
  };
}
