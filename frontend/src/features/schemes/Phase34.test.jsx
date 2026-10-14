import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App.jsx';
import { configFromForm, emptyForm, formFromConfig } from './SchemeConfigForm.jsx';

const users = [
  { id: 'u-ops', name: 'Ops Head', roles: ['OPS_HEAD'], branchIds: 'ALL' },
  { id: 'u-maker', name: 'Maker', roles: ['CHIT_OPS'], branchIds: ['CHN'] },
];
const perms = {
  'u-ops': ['scheme:view', 'group:view', 'group:approve', 'group:open-enrolment', 'approval:view'],
  'u-maker': ['scheme:view', 'group:view', 'group:attest', 'approval:view'],
};
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function stub(handlers = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^.*\/api\/v1/, '').split('?')[0];
    const key = `${init.method ?? 'GET'} ${path}`;
    if (handlers[key]) return handlers[key](init);
    if (path === '/dev/users') return ok({ users });
    if (path === '/me') {
      const id = init.headers?.['x-dev-user'];
      return ok({ user: users.find((u) => u.id === id), permissions: perms[id] });
    }
    return ok({ error: { code: 'X', message: `unmocked ${key}` } }, 500);
  }));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

const cfg = {
  name: 'Scheme', jurisdiction: 'TAMIL_NADU', chitValuePaise: 20000000, memberCount: 20, installmentAmountPaise: 1000000, frequency: 'MONTHLY', tenureMonths: 20,
  auction: { mode: 'STAFF_ASSISTED' }, requiredDocuments: [], complianceChecklist: [], maxTicketsPerMember: 1, minEnrolmentToActivate: 20, effectiveFrom: '2026-01-01',
};

describe('scheme form mapping', () => {
  it('sends the new fields and the overdue rules in the shape the server expects', () => {
    const f = {
      ...emptyForm, name: 'Scheme', chitValue: '200000', memberCount: '20', installmentAmount: '10000', tenureMonths: '20', auctionMode: 'STAFF_ASSISTED',
      effectiveFrom: '2026-01-01', schemeType: 'Monthly', permittedBranchIds: ['CHN'], roundingPolicyText: 'As approved',
      odGraceDays: '3', odPartialStops: 'YES', odHolidayPolicy: 'NEXT_UNLISTED_DAY', odNonWorkingDates: '2026-12-25\n2026-12-26', odRemindBefore: '3, 1', odRemindAfter: '', odConfirmationRef: '',
    };
    const c = configFromForm(f);
    expect(c.schemeType).toBe('Monthly');
    expect(c.permittedBranchIds).toEqual(['CHN']);
    expect(c.overdueRules).toMatchObject({
      graceDays: 3, partialPaymentStopsOverdue: true, holidayPolicy: 'NEXT_UNLISTED_DAY', nonWorkingDates: ['2026-12-25', '2026-12-26'],
      reminderDaysBefore: [3, 1], reminderDaysAfter: [], policyConfirmationRef: undefined,
    });
  });

  it('round-trips a stored configuration back into the form, including a scheme without overdue rules', () => {
    const withRules = { ...cfg, schemeType: 'Weekly', overdueRules: { graceDays: 0, partialPaymentStopsOverdue: false, holidayPolicy: 'NONE', nonWorkingDates: [], reminderDaysBefore: [2], reminderDaysAfter: [], policyConfirmationRef: 'C-1' } };
    const f = formFromConfig(withRules);
    expect(f.odGraceDays).toBe('0'); // zero is a real value, not "unset"
    expect(f.odRemindBefore).toBe('2');
    expect(f.odConfirmationRef).toBe('C-1');
    const legacy = formFromConfig(cfg);
    expect(legacy.odGraceDays).toBe('');
    expect(legacy.permittedBranchIds).toEqual([]);
    expect(configFromForm(legacy).overdueRules.graceDays).toBeUndefined();
  });

  it('passes unparseable reminder entries through so the server can reject them', () => {
    expect(configFromForm({ ...emptyForm, odRemindBefore: '3, x' }).overdueRules.reminderDaysBefore).toEqual([3, 'x']);
  });
});

describe('group detail with the Approved state', () => {
  const group = (over = {}, actions = {}) => ({
    id: 'GRP-0001', code: 'GRP-A', name: 'Group A', branchId: 'CHN', status: 'APPROVED', plannedStartDate: '2026-12-01',
    enrolmentStartDate: '2026-12-05', enrolmentEndDate: undefined,
    instalmentSchedule: [{ seq: 1, dueDate: '2026-12-01' }, { seq: 2, dueDate: '2027-01-01' }],
    auctionSchedule: [{ cycleNo: 1, plannedDate: '2027-01-05' }],
    complianceDocuments: [{ id: 'DOC-1', title: 'Registrar approval', reference: 'REG-1', addedByName: 'Maker', addedAt: '2026-11-01T10:00:00Z' }],
    schedulesNotice: 'Instalment dates follow a provisional monthly rule and auction dates are planning entries; both are unapproved until the business confirms the rules.',
    scheme: { id: 'SCH-0001', versionId: 'SCV-0001', version: 1, name: 'Scheme', status: 'PUBLISHED', config: cfg },
    tickets: [{ no: 1, history: [] }], checklist: [], history: [], allocatedCount: 0, approvalRequests: [],
    readiness: { items: [], allMet: false },
    actions: { canOpenEnrolment: false, canAddDocument: false, ...actions }, ...over,
  });

  it('explains that approval does not open enrolment and offers Open enrolment only to those who can', async () => {
    localStorage.setItem('crm.devUser', 'u-ops');
    stub({ 'GET /groups/GRP-0001': () => ok(group({}, { canOpenEnrolment: true })) });
    renderAt('/schemes/groups/GRP-0001');
    expect(await screen.findByText(/Enrolment is not open yet/)).toBeInTheDocument();
    expect(screen.getByText(/not before 2026-12-05/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open enrolment' })).toBeInTheDocument();
    expect(screen.getByText('Registrar approval')).toBeInTheDocument();
    expect(screen.getByText(/unapproved until the business confirms/)).toBeInTheDocument();
  });

  it('hides Open enrolment without the permission', async () => {
    localStorage.setItem('crm.devUser', 'u-maker');
    stub({ 'GET /groups/GRP-0001': () => ok(group()) });
    renderAt('/schemes/groups/GRP-0001');
    expect(await screen.findByText(/Enrolment is not open yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open enrolment' })).not.toBeInTheDocument();
  });

  it('posts to the open-enrolment endpoint after confirmation', async () => {
    localStorage.setItem('crm.devUser', 'u-ops');
    const opened = vi.fn(() => ok(group({ status: 'ENROLMENT_OPEN' })));
    stub({ 'GET /groups/GRP-0001': () => ok(group({}, { canOpenEnrolment: true })), 'POST /groups/GRP-0001/open-enrolment': opened });
    renderAt('/schemes/groups/GRP-0001');
    await userEvent.click(await screen.findByRole('button', { name: 'Open enrolment' }));
    const dialogButtons = await screen.findAllByRole('button', { name: 'Open enrolment' });
    await userEvent.click(dialogButtons[dialogButtons.length - 1]);
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

describe('calculation rules page', () => {
  const rules = {
    notice: 'No financial calculation rule has been approved. Dividend, commission, discount and prize-amount figures cannot be produced until an accountant-approved rule set is registered and validated.',
    kinds: ['DIVIDEND', 'COMMISSION', 'DISCOUNT', 'PRIZE_AMOUNT'].map((kind) => ({ kind, ruleSets: [], productionReady: false })),
    sample: { label: 'SAMPLE DATA, NOT A REAL SCHEME. For demonstrating the preview only.', chitValuePaise: 10000000, memberCount: 10, installmentAmountPaise: 1000000 },
  };

  it('shows that no rule is approved and labels the sample preview, producing no figure', async () => {
    localStorage.setItem('crm.devUser', 'u-ops');
    stub({
      'GET /calculations/rules': () => ok(rules),
      'POST /calculations/preview': () => ok({ kind: 'DIVIDEND', mode: 'SAMPLE', status: 'RULES_NOT_VALIDATED', productionUse: false, notices: ['No approved rule is registered for DIVIDEND. No figure is produced.'] }),
    });
    renderAt('/schemes/calculations');
    expect(await screen.findByText(/No financial calculation rule has been approved/)).toBeInTheDocument();
    expect(screen.getByText(/SAMPLE DATA, NOT A REAL SCHEME/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/No figure is produced/)).toBeInTheDocument();
    expect(screen.queryByText(/Preview amount/)).not.toBeInTheDocument();
  });
});
