// DEMO SEED DATA ONLY. Not real business or financial data.
// Kept separate from business logic; replaced by real repositories in later phases.
export const dashboardDemo = {
  leads: { total: 128, contacted: 74, interested: 41, converted: 19 },
  kyc: { pending: 23, underReview: 11, correctionRequired: 4 },
  schemes: { active: 6 },
  groups: { active: 9, enrolmentOpen: 3 },
  memberships: { active: 214 },
  collections: { dueAmount: 1850000, receivedAmount: 1420000, overdueAmount: 235000 },
  upcomingAuctions: [
    { id: 'demo-a1', group: 'GRP-DEMO-001', date: '2026-10-20' },
    { id: 'demo-a2', group: 'GRP-DEMO-004', date: '2026-10-24' },
  ],
  approvals: { auctionsPending: 2, payoutsPending: 3 },
  reconciliationExceptions: 5,
  alerts: [
    { id: 'demo-al1', level: 'warning', message: 'Sample alert: 5 payments awaiting reconciliation' },
    { id: 'demo-al2', level: 'info', message: 'Sample alert: Accounting period close is due' },
  ],
};
