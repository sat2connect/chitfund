import { readFileSync } from 'node:fs';
import type { Account, AccountType } from '../domain/types.js';
import type { PersistentStore } from '../persistence/persistentStore.js';
import type { Store } from '../repositories/store.js';
import { audit } from '../services/common.js';
import { connectWithStore, isMain, run } from './common.js';

const TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
const SYSTEM = { id: 'system', name: 'System', roles: [], branchIds: 'ALL' as const };

export interface PilotConfig {
  /** Who approved the chart of accounts and posting rules, and when. Recorded in the audit trail. */
  accountantApproval: { approvedBy: string; approvedOn: string; reference?: string };
  branches: { id: string; name: string }[];
  accounts: { code: string; name: string; type: AccountType }[];
  postingRules: { debitByMode: Record<string, string>; creditAccountCode: string; payoutDebitCode: string; payoutCreditByChannel: Record<string, string> };
  fiscalCalendar: { startDate: string; months: number };
  settings?: { graceDays?: number };
}

/** Validates a pilot configuration and returns every problem found. */
export function validatePilotConfig(c: PilotConfig, store: Store): string[] {
  const p: string[] = [];
  if (!c.accountantApproval?.approvedBy || !/^\d{4}-\d{2}-\d{2}$/.test(c.accountantApproval?.approvedOn ?? '')) {
    p.push('accountantApproval.approvedBy and approvedOn (YYYY-MM-DD) are required: the chart and posting rules need accountant sign-off');
  }
  if (store.branches.length || store.accounts.length || store.periods.length) p.push('The system already has branches, accounts or periods; this tool only initialises an empty system');
  if (!c.branches?.length) p.push('At least one branch is required');
  const ids = new Set<string>();
  for (const b of c.branches ?? []) {
    if (!/^[A-Z0-9]{2,8}$/.test(b.id)) p.push(`Branch id "${b.id}" must be 2-8 capital letters or digits`);
    if (!b.name || b.name.trim().length < 2) p.push(`Branch ${b.id} needs a name`);
    if (ids.has(b.id)) p.push(`Duplicate branch id ${b.id}`);
    ids.add(b.id);
  }
  const codes = new Set<string>();
  for (const a of c.accounts ?? []) {
    if (!/^\d{3,8}$/.test(a.code)) p.push(`Account code "${a.code}" must be 3-8 digits`);
    if (!TYPES.includes(a.type)) p.push(`Account ${a.code} has an unknown type "${a.type}"`);
    if (!a.name || a.name.trim().length < 3) p.push(`Account ${a.code} needs a name`);
    if (codes.has(a.code)) p.push(`Duplicate account code ${a.code}`);
    codes.add(a.code);
  }
  if (!c.accounts?.length) p.push('A chart of accounts is required');
  const rules = c.postingRules;
  const need = (label: string, code: string | undefined, types: AccountType[]) => {
    const acc = c.accounts?.find((a) => a.code === code);
    if (!acc) p.push(`Posting rule ${label} refers to unknown account "${code}"`);
    else if (!types.includes(acc.type)) p.push(`Posting rule ${label} uses account ${code}, which is a ${acc.type} account`);
  };
  if (!rules) p.push('postingRules are required');
  else {
    for (const m of ['CASH', 'CHEQUE', 'UPI', 'BANK_TRANSFER', 'ONLINE_SIMULATED']) need(`debit for ${m}`, rules.debitByMode?.[m], ['ASSET']);
    need('credit for collections', rules.creditAccountCode, ['LIABILITY', 'INCOME']);
    need('payout debit', rules.payoutDebitCode, ['LIABILITY', 'EXPENSE']);
    for (const ch of ['BANK_TRANSFER', 'CHEQUE']) need(`payout credit for ${ch}`, rules.payoutCreditByChannel?.[ch], ['ASSET']);
  }
  const f = c.fiscalCalendar;
  if (!f || !/^\d{4}-\d{2}-01$/.test(f.startDate) || !Number.isInteger(f.months) || f.months < 1 || f.months > 36) p.push('fiscalCalendar needs a startDate on the 1st of a month (YYYY-MM-01) and months between 1 and 36');
  if (c.settings?.graceDays !== undefined && (!Number.isInteger(c.settings.graceDays) || c.settings.graceDays < 0 || c.settings.graceDays > 60)) p.push('settings.graceDays must be a whole number from 0 to 60');
  return p;
}

/** Loads branches, the approved chart of accounts, posting rules and monthly periods into an empty system. */
export async function initPilot(persist: PersistentStore, store: Store, c: PilotConfig): Promise<void> {
  const problems = validatePilotConfig(c, store);
  if (problems.length) throw new Error(`Pilot configuration rejected:\n - ${problems.join('\n - ')}`);

  for (const b of c.branches) store.branches.push({ id: b.id, name: b.name.trim() });
  for (const a of c.accounts) store.accounts.push({ id: store.nextId('ACC'), code: a.code, name: a.name.trim(), type: a.type, active: true, placeholder: false } satisfies Account);
  Object.assign(store.postingRules, c.postingRules);
  if (c.settings?.graceDays !== undefined) store.settings.graceDays = c.settings.graceDays;
  const [y, m] = c.fiscalCalendar.startDate.split('-').map(Number) as [number, number];
  for (let i = 0; i < c.fiscalCalendar.months; i += 1) {
    const start = new Date(Date.UTC(y, m - 1 + i, 1));
    const end = new Date(Date.UTC(y, m + i, 0));
    store.periods.push({
      id: store.nextId('PER'), name: start.toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), status: 'OPEN', history: [],
    });
  }
  audit(store, SYSTEM, 'system.init_pilot', 'system', 'pilot', { ...c.accountantApproval, branches: c.branches.length, accounts: c.accounts.length, periods: c.fiscalCalendar.months });
  try {
    await persist.commit();
  } catch (e) {
    persist.restore();
    throw e;
  }
}

export async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run init-pilot -- <pilot-config.json>   (see docs/deployment.md)');
  const config = JSON.parse(readFileSync(file, 'utf8')) as PilotConfig;
  const { db, store, persist } = await connectWithStore();
  try {
    await initPilot(persist, store, config);
    console.log(`Initialised ${config.branches.length} branch(es), ${config.accounts.length} account(s), ${config.fiscalCalendar.months} period(s).`);
  } finally {
    await db.close();
  }
}
if (isMain(import.meta.url)) await run(main);