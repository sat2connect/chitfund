// DEMO SEED DATA ONLY: simulated users and sample records. Not real people or business data.
import { createEmptyStore, type Store } from '../repositories/store.js';
import type { Account, Lead } from '../domain/types.js';

/** Populates a store with clearly labelled demo data. Never used in production. */
export const seedDemoData = (s: Store): Store => {
  s.branches.push(
    { id: 'CHN', name: 'Chennai Central' },
    { id: 'CBE', name: 'Coimbatore' },
    { id: 'MDU', name: 'Madurai' },
  );
  s.users.push(
    { id: 'u-admin', name: 'Asha (Super Admin)', roles: ['SUPER_ADMIN'], branchIds: 'ALL' },
    { id: 'u-ops', name: 'Ravi (Operations Head)', roles: ['OPS_HEAD'], branchIds: 'ALL' },
    { id: 'u-bm-chn', name: 'Meena (Branch Manager, Chennai)', roles: ['BRANCH_MANAGER'], branchIds: ['CHN'] },
    { id: 'u-crm-chn', name: 'Karthik (CRM, Chennai)', roles: ['CRM_EXEC'], branchIds: ['CHN'] },
    { id: 'u-crm-cbe', name: 'Divya (CRM, Coimbatore)', roles: ['CRM_EXEC'], branchIds: ['CBE'] },
    { id: 'u-kyc', name: 'Suresh (KYC Officer)', roles: ['KYC_OFFICER'], branchIds: 'ALL' },
    { id: 'u-chitops', name: 'Lakshmi (Chit Ops)', roles: ['CHIT_OPS'], branchIds: ['CHN'] },
    { id: 'u-multi', name: 'Anand (Chit Ops + Ops Head, test multi-role)', roles: ['CHIT_OPS', 'OPS_HEAD'], branchIds: 'ALL' },
    { id: 'u-col-chn', name: 'Murugan (Collection Officer, Chennai)', roles: ['COLLECTION_OFFICER'], branchIds: ['CHN'] },
    { id: 'u-col-cbe', name: 'Selvi (Collection Officer, Coimbatore)', roles: ['COLLECTION_OFFICER'], branchIds: ['CBE'] },
    { id: 'u-fin-maker', name: 'Nisha (Finance Maker)', roles: ['FINANCE_MAKER'], branchIds: 'ALL' },
    { id: 'u-fin-checker', name: 'Gopal (Finance Checker)', roles: ['FINANCE_CHECKER'], branchIds: 'ALL' },
    { id: 'u-fin-both', name: 'Test (Finance Maker + Checker)', roles: ['FINANCE_MAKER', 'FINANCE_CHECKER'], branchIds: 'ALL' },
    { id: 'u-auction', name: 'Vimal (Auction Officer)', roles: ['AUCTION_OFFICER'], branchIds: ['CHN'] },
    { id: 'u-audit', name: 'Priya (Auditor)', roles: ['AUDITOR'], branchIds: 'ALL' },
  );

  // PLACEHOLDER chart of accounts and posting rules. NOT approved by the client's accountant.
  const acc = (code: string, name: string, type: Account['type']) =>
    s.accounts.push({ id: s.nextId('ACC'), code, name, type, active: true, placeholder: true });
  acc('1010', 'Cash in hand', 'ASSET');
  acc('1020', 'Bank - collections', 'ASSET');
  acc('1030', 'Payment gateway clearing', 'ASSET');
  acc('2100', 'Chit subscription collections', 'LIABILITY');
  acc('2200', 'Prize payouts payable', 'LIABILITY');
  acc('3100', 'Capital and reserves', 'EQUITY');
  acc('4100', 'Commission income', 'INCOME');
  acc('5100', 'Operating expenses', 'EXPENSE');
  s.postingRules = {
    debitByMode: { CASH: '1010', CHEQUE: '1020', UPI: '1020', BANK_TRANSFER: '1020', ONLINE_SIMULATED: '1030' },
    creditAccountCode: '2100',
    // PLACEHOLDER: no liability is accrued at auction approval; accountant to confirm payout treatment.
    payoutDebitCode: '2200',
    payoutCreditByChannel: { BANK_TRANSFER: '1020', CHEQUE: '1020' },
  };
  // Monthly periods for April 2026 - March 2027 (placeholder fiscal calendar), all open.
  for (let i = 0; i < 12; i += 1) {
    const start = new Date(Date.UTC(2026, 3 + i, 1));
    const end = new Date(Date.UTC(2026, 4 + i, 0));
    s.periods.push({
      id: s.nextId('PER'), name: start.toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), status: 'OPEN', history: [],
    });
  }

  const now = new Date().toISOString();
  const addLead = (l: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => {
    s.leads.push({ ...l, id: s.nextId('LD'), createdBy: 'u-crm-chn', createdAt: now, updatedAt: now });
  };
  addLead({ name: 'Sample Lead One', phone: '9000000001', source: 'WALK_IN', branchId: 'CHN', status: 'NEW', assignedTo: 'u-crm-chn' });
  addLead({ name: 'Sample Lead Two', phone: '9000000002', source: 'REFERRAL', branchId: 'CHN', status: 'CONTACTED', assignedTo: 'u-crm-chn' });
  addLead({ name: 'Sample Lead Three', phone: '9000000003', source: 'PHONE', branchId: 'CBE', status: 'INTERESTED', assignedTo: 'u-crm-cbe' });
  addLead({ name: 'Sample Lead Four', phone: '9000000004', source: 'CAMPAIGN', branchId: 'MDU', status: 'NEW' });

  const cid = s.nextId('CU');
  s.customers.push({
    id: cid, name: 'Sample Customer One', phone: '9000000101', branchId: 'CHN',
    kycStatus: 'NOT_STARTED', membershipStatus: 'NONE', createdBy: 'u-crm-chn', createdAt: now,
  });
  s.kycCases.push({ id: s.nextId('KYC'), customerId: cid, branchId: 'CHN', status: 'NOT_STARTED', documents: [], history: [] });
  return s;
};


export const createSeededStore = (): Store => seedDemoData(createEmptyStore());
