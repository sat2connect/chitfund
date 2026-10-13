import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App.jsx';

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const err = (status, code, message, details) => ok({ error: { code, message, details, requestId: 'req-1' } }, status);

const STAFF = { id: 'USR-0002', name: 'Karthik Raman', roles: ['CRM_EXEC'], branchIds: ['CHN'] };
const ADMIN = { id: 'USR-0001', name: 'Asha Admin', roles: ['SUPER_ADMIN'], branchIds: 'ALL' };
const MEMBER = { id: 'u-member-CU-1', name: 'Member One', roles: ['CHIT_MEMBER'], branchIds: [], customerId: 'CU-1' };
const permsFor = (u) => (u === ADMIN ? ['user:view', 'user:manage', 'audit:view', 'customer:view'] : u === MEMBER ? ['portal:access', 'auction:view'] : ['lead:view', 'lead:create', 'customer:view']);
const session = (u) => ({ status: 'AUTHENTICATED', user: u, permissions: permsFor(u), csrfToken: 'csrf-123', expiresAt: '2026-12-02T00:00:00Z' });

let calls;
let state;

function stub(extra = {}) {
  calls = [];
  state = { signedInAs: null, ...extra.state };
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^.*\/api\/v1/, '').split('?')[0];
    const key = `${init.method ?? 'GET'} ${path}`;
    calls.push({ key, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined, credentials: init.credentials });
    if (extra.handlers?.[key]) return extra.handlers[key](init);
    switch (key) {
      case 'GET /auth/config': return ok({ mode: 'session', passwordMinLength: 12 });
      case 'GET /auth/session': return state.signedInAs ? ok(session(state.signedInAs)) : err(401, 'UNAUTHENTICATED', 'Sign in to continue');
      case 'POST /auth/login': {
        const { username, password } = JSON.parse(init.body);
        if (password !== 'good-passphrase-123') return err(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
        if (username === 'asha@x.org') return ok({ status: 'MFA_REQUIRED', challengeToken: 'chal-1' });
        if (username === 'new@x.org') return ok({ status: 'MFA_ENROLLMENT_REQUIRED', challengeToken: 'chal-2', secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' });
        state.signedInAs = MEMBER;
        return ok(session(MEMBER));
      }
      case 'POST /auth/mfa/verify': {
        const { code } = JSON.parse(init.body);
        if (code !== '123456') return err(401, 'INVALID_CODE', 'That code is not valid or has expired');
        state.signedInAs = ADMIN;
        return ok(session(ADMIN));
      }
      case 'POST /auth/mfa/enroll':
        state.signedInAs = STAFF;
        return ok({ ...session(STAFF), recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'], recoveryNotice: 'Store these recovery codes safely. They are shown only once and each works once.' }, 200);
      case 'POST /auth/logout': state.signedInAs = null; return ok({ status: 'SIGNED_OUT' });
      case 'GET /leads': return ok({ items: [], page: 1, pageSize: 10, total: 0 });
      case 'GET /dashboard/summary': return ok({ dataSource: 'demo', notice: 'Sample', data: { leads: { total: 0, converted: 0 }, kyc: { pending: 0, underReview: 0 }, schemes: { active: 0 }, groups: { active: 0 }, memberships: { active: 0 }, collections: { dueAmount: 0, receivedAmount: 0, overdueAmount: 0 }, upcomingAuctions: [], approvals: { auctionsPending: 0, payoutsPending: 0 }, reconciliationExceptions: 0, alerts: [] } });
      case 'GET /portal/summary': return ok({ today: '2026-12-01', customer: { id: 'CU-1', name: 'Member One', kycStatus: 'VERIFIED', membershipStatus: 'ACTIVE' }, totals: { outstandingDuePaise: 0, overduePaise: 0, paidPaise: 0 }, memberships: [], openSupportCases: 0, pendingPaymentAttempts: 0 });
      default: return err(500, 'X', `unmocked ${key}`);
    }
  }));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
const renderAt = (path = '/') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const signInWith = async (username) => {
  await userEvent.type(await screen.findByLabelText(/Email or mobile number/), username);
  await userEvent.type(screen.getByLabelText('Password'), 'good-passphrase-123');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
};

describe('session sign-in', () => {
  it('shows only the sign-in screen when there is no session', async () => {
    stub();
    renderAt('/leads');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Primary' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Simulated user')).not.toBeInTheDocument();
    expect(calls.some((c) => c.key === 'GET /leads')).toBe(false); // nothing is requested before sign-in
    expect(calls.some((c) => c.key === 'GET /dev/users')).toBe(false);
    expect(calls.every((c) => c.credentials === 'include')).toBe(true); // the session cookie travels
  });

  it('gives one generic message for a wrong password', async () => {
    stub();
    renderAt();
    await userEvent.type(await screen.findByLabelText(/Email or mobile number/), 'asha@x.org');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-wrong-wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue(''); // the password is not kept
  });

  it('asks for the authenticator code, rejects a bad one, then signs in and shows no simulated banner', async () => {
    stub();
    renderAt();
    await signInWith('asha@x.org');
    const code = await screen.findByLabelText(/^Code/);
    await userEvent.type(code, '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('That code is not valid or has expired')).toBeInTheDocument();
    await userEvent.clear(code);
    await userEvent.type(code, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Asha Admin')).toBeInTheDocument();
    expect(screen.queryByText(/Simulated sign-in/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('walks a new staff member through authenticator enrolment and holds on the recovery codes', async () => {
    stub();
    renderAt();
    await signInWith('new@x.org');
    expect(await screen.findByTestId('mfa-secret')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    const confirm = screen.getByRole('button', { name: 'Confirm and sign in' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/6-digit code/), '123456');
    await userEvent.click(confirm);
    const list = await screen.findByLabelText('Recovery codes');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('complementary', { name: 'Primary' })).not.toBeInTheDocument(); // still on the codes screen
    await userEvent.click(screen.getByRole('button', { name: 'I have saved these codes' }));
    expect(await screen.findByRole('complementary', { name: 'Primary' })).toBeInTheDocument();
  });

  it('sends the CSRF token on state-changing requests and signs out cleanly', async () => {
    stub({ state: { signedInAs: STAFF } });
    renderAt('/leads');
    await screen.findByText('Karthik Raman');
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    const logout = calls.find((c) => c.key === 'POST /auth/logout');
    expect(logout.headers['x-csrf-token']).toBe('csrf-123');
    const gets = calls.filter((c) => c.key.startsWith('GET'));
    expect(gets.every((c) => c.headers['x-csrf-token'] === undefined)).toBe(true);
  });

  it('returns to sign-in when the server says the session has ended', async () => {
    stub({ state: { signedInAs: STAFF }, handlers: { 'GET /leads': () => err(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.') } });
    renderAt('/crm');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('gives members the portal shell with sign-out, never a staff menu', async () => {
    stub({ state: { signedInAs: MEMBER } });
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Welcome, Member One' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Portal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByText(/Simulated/)).not.toBeInTheDocument();
  });
});

describe('activation', () => {
  it('validates the new password in the browser before sending anything', async () => {
    stub();
    renderAt('/activate');
    await userEvent.type(await screen.findByLabelText(/Email or mobile number/), 'karthik@x.org');
    await userEvent.type(screen.getByLabelText(/One-time activation code/), 'K7M2P-9XQ4T-HB3RV');
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    expect(screen.getByText('Use at least 12 characters')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Activate account' });
    expect(submit).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.type(screen.getByLabelText('New password'), 'a-long-unusual-passphrase-42');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'different-passphrase-99');
    expect(screen.getByText('The two passwords do not match')).toBeInTheDocument();
    expect(submit).toBeDisabled();
    expect(calls.some((c) => c.key === 'POST /auth/activate')).toBe(false);
  });

  it('shows the server\'s reason when the password is too common or the code is wrong, and confirms on success', async () => {
    let reply = () => err(400, 'VALIDATION_ERROR', 'Choose a stronger password', { newPassword: 'This password is too common' });
    stub({ handlers: { 'POST /auth/activate': () => reply() } });
    renderAt('/activate');
    await userEvent.type(await screen.findByLabelText(/Email or mobile number/), 'karthik@x.org');
    await userEvent.type(screen.getByLabelText(/One-time activation code/), 'K7M2P-9XQ4T-HB3RV');
    await userEvent.type(screen.getByLabelText('New password'), 'chitfund@123456');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'chitfund@123456');
    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(await screen.findByText('This password is too common')).toBeInTheDocument();
    reply = () => err(400, 'INVALID_ACTIVATION', 'This activation code is not valid or has expired');
    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(await screen.findByText('This activation code is not valid or has expired')).toBeInTheDocument();
    reply = () => ok({ status: 'ACTIVATED' });
    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(await screen.findByText('Account activated')).toBeInTheDocument();
  });
});

describe('user administration', () => {
  const users = { items: [
    { id: 'USR-0001', name: 'Asha Admin', username: 'asha@x.org', roles: ['SUPER_ADMIN'], branchIds: 'ALL', status: 'ACTIVE', activated: true, mfaEnabled: true, lastLoginAt: '2026-12-01T04:00:00Z' },
    { id: 'USR-0002', name: 'Karthik Raman', username: 'karthik@x.org', roles: ['CRM_EXEC'], branchIds: ['CHN'], status: 'ACTIVE', activated: false, mfaEnabled: false },
    { id: 'USR-0003', name: 'Old Hand', username: 'old@x.org', roles: ['AUDITOR'], branchIds: 'ALL', status: 'DISABLED', activated: true, mfaEnabled: true },
  ] };
  const handlers = (over = {}) => ({
    'GET /users': () => ok(users),
    'GET /crm/meta': () => ok({ branches: [{ id: 'CHN', name: 'Chennai' }, { id: 'CBE', name: 'Coimbatore' }] }),
    'GET /customers': () => ok({ items: [{ id: 'CU-9', name: 'Verified Person', phone: '9000000009' }], page: 1, pageSize: 100, total: 1 }),
    ...over,
  });

  it('lists accounts without offering actions on your own account, and labels each state', async () => {
    stub({ state: { signedInAs: ADMIN }, handlers: handlers() });
    renderAt('/admin/users');
    expect(await screen.findByText('Karthik Raman')).toBeInTheDocument();
    expect(screen.getByText('Awaiting activation')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    const self = rows.find((r) => within(r).queryByText('Asha Admin'));
    expect(within(self).queryByRole('button')).not.toBeInTheDocument();
    const other = rows.find((r) => within(r).queryByText('Karthik Raman'));
    expect(within(other).getByRole('button', { name: 'New code' })).toBeInTheDocument();
  });

  it('creates a staff account and shows the one-time code exactly once', async () => {
    stub({ state: { signedInAs: ADMIN }, handlers: handlers({
      'POST /users': () => ok({ user: { id: 'USR-0004', name: 'New Person', username: 'new@x.org' }, activation: { code: 'ABCDE-FGHJK-MNPQR', expiresAt: '2026-12-04T04:00:00Z' } }, 201),
    }) });
    renderAt('/admin/users');
    await userEvent.type(await screen.findByLabelText(/Full name/), 'New Person');
    await userEvent.type(screen.getByLabelText(/Work email/), 'new@x.org');
    const create = screen.getByRole('button', { name: 'Create account' });
    expect(create).toBeDisabled(); // needs a role and a branch
    await userEvent.click(screen.getByLabelText('Crm exec'));
    await userEvent.click(screen.getByLabelText('Chennai'));
    expect(create).toBeEnabled();
    await userEvent.click(create);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('activation-code')).toHaveTextContent('ABCDE-FGHJK-MNPQR');
    expect(within(dialog).getByText(/shown only once/)).toBeInTheDocument();
    const sent = calls.find((c) => c.key === 'POST /users');
    expect(sent.body).toEqual({ name: 'New Person', username: 'new@x.org', roles: ['CRM_EXEC'], branchIds: ['CHN'] });
    expect(sent.headers['x-csrf-token']).toBe('csrf-123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('activation-code')).not.toBeInTheDocument();
  });

  it('shows the separation-of-duties refusal from the server next to the roles', async () => {
    stub({ state: { signedInAs: ADMIN }, handlers: handlers({
      'POST /users': () => err(400, 'VALIDATION_ERROR', 'Validation failed', { roles: 'FINANCE_MAKER and FINANCE_CHECKER cannot be held by the same person (separation of duties)' }),
    }) });
    renderAt('/admin/users');
    await userEvent.type(await screen.findByLabelText(/Full name/), 'Two Hats');
    await userEvent.type(screen.getByLabelText(/Work email/), 'two@x.org');
    await userEvent.click(screen.getByLabelText('Finance maker'));
    await userEvent.click(screen.getByLabelText('Finance checker'));
    await userEvent.click(screen.getByLabelText('All branches (central role)'));
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/separation of duties/)).toBeInTheDocument();
  });

  it('hides management controls from users who may only view', async () => {
    const viewer = { ...STAFF, id: 'USR-0009', name: 'Viewer' };
    stub({ state: { signedInAs: viewer }, handlers: handlers() });
    // a viewer with user:view but not user:manage
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const path = String(url).replace(/^.*\/api\/v1/, '');
      if (path === '/auth/session') return ok({ ...session(viewer), permissions: ['user:view'] });
      return original(url, init);
    }));
    renderAt('/admin/users');
    expect(await screen.findByText('Karthik Raman')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New code' })).not.toBeInTheDocument();
  });
});

describe('change password', () => {
  it('requires the current password and shows the server\'s answer', async () => {
    stub({ state: { signedInAs: STAFF }, handlers: { 'POST /auth/change-password': () => err(403, 'WRONG_PASSWORD', 'Your current password is not correct') } });
    renderAt('/account/password');
    await userEvent.type(await screen.findByLabelText('Current password'), 'old-passphrase-123');
    await userEvent.type(screen.getByLabelText('New password'), 'a-long-unusual-passphrase-42');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-long-unusual-passphrase-42');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(screen.getByText('Your current password is not correct')).toBeInTheDocument());
  });
});
