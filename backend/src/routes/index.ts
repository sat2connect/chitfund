import { Router } from 'express';
import { createCrmController } from '../controllers/crmController.js';
import { createDashboardController } from '../controllers/dashboardController.js';
import { devAuthenticate, requirePermission as need } from '../middleware/auth.js';
import { demoDashboardRepository } from '../repositories/dashboardRepository.js';
import type { Store } from '../repositories/store.js';
import { createApplicationService } from '../services/applicationService.js';
import { createCrmService } from '../services/crmService.js';
import { createDashboardService } from '../services/dashboardService.js';
import { createKycService } from '../services/kycService.js';
import { createApprovalService } from '../services/approvalService.js';
import { createSchemeService } from '../services/schemeService.js';
import { createGroupService } from '../services/groupService.js';
import { createCalculationService } from '../services/calculationService.js';
import { createChitController } from '../controllers/chitController.js';
import type { RequestHandler, Router as ExpressRouter } from 'express';
import type { UserAdminService } from '../auth/userAdminService.js';
import { forbidden } from '../errors/AppError.js';
import { createPortalController } from '../controllers/portalController.js';
import { createPortalService } from '../services/portalService.js';
import { createSupportService } from '../services/supportService.js';
import { createFinanceController } from '../controllers/financeController.js';
import { createInstalmentService } from '../services/instalmentService.js';
import { createAccountingService } from '../services/accountingService.js';
import { createCollectionService } from '../services/collectionService.js';
import { createAuctionService } from '../services/auctionService.js';
import { createPayoutService } from '../services/payoutService.js';
import { createAuctionController } from '../controllers/auctionController.js';

/**
 * DEVELOPMENT ONLY: gives every member of an activated group a simulated sign-in so member bidding can be
 * exercised. Real customer authentication is a later phase and an undecided provider.
 */
const ensureSimulatedMemberUsers = (store: Store, g: { tickets: { customerId?: string }[] }) => {
  for (const t of g.tickets) {
    if (!t.customerId || store.users.some((u) => u.customerId === t.customerId)) continue;
    const c = store.customers.find((x) => x.id === t.customerId);
    store.users.push({ id: `u-member-${t.customerId}`, name: `${c?.name ?? t.customerId} (Member, simulated)`, roles: ['CHIT_MEMBER'], branchIds: [], customerId: t.customerId });
  }
};

export interface RouterDeps {
  /** dev: x-dev-user header (development only). session: real accounts, with auth routes and user administration. */
  mode: 'dev' | 'session';
  authenticate?: RequestHandler;
  authRouter?: ExpressRouter;
  userAdmin?: UserAdminService;
}

export const createApiRouter = (store: Store, deps: RouterDeps = { mode: 'dev' }) => {
  const r = Router();
  const c = createCrmController(store, createCrmService(store), createKycService(store), createApplicationService(store));
  const approvalSvc = createApprovalService(store);
  const instalmentSvc = createInstalmentService(store);
  const accountingSvc = createAccountingService(store, approvalSvc);
  const collectionSvc = createCollectionService(store, approvalSvc, instalmentSvc, accountingSvc);
  const fin = createFinanceController(instalmentSvc, collectionSvc, accountingSvc);
  const auctionSvc = createAuctionService(store, approvalSvc, instalmentSvc);
  const payoutSvc = createPayoutService(store, approvalSvc, accountingSvc, auctionSvc, instalmentSvc);
  const au = createAuctionController(auctionSvc, payoutSvc);
  const supportSvc = createSupportService(store);
  const po = createPortalController(createPortalService(store, instalmentSvc, collectionSvc), supportSvc);
  const groupSvc = createGroupService(store, approvalSvc, {
    onActivated: (g, cfg) => {
      instalmentSvc.generateForGroup(g, cfg);
      if (dev) ensureSimulatedMemberUsers(store, g); // real deployments issue member accounts explicitly
    },
  });
  const ch = createChitController(createSchemeService(store, approvalSvc), groupSvc, approvalSvc, createCalculationService());
  const dashboard = createDashboardController(createDashboardService(demoDashboardRepository));

  const dev = deps.mode === 'dev';
  if (dev) r.get('/dev/users', c.devUsers); // simulated sign-in list: never mounted in session mode
  else r.use('/auth', deps.authRouter!);

  // Everything below requires an authenticated (simulated) user; each route also checks permission,
  // and services enforce branch scope and maker-checker rules.
  r.use(dev ? devAuthenticate(store) : deps.authenticate!);
  r.get('/me', c.me);
  r.get('/crm/meta', c.meta);
  // The (demo) staff dashboard is not for member sessions.
  r.get('/dashboard/summary', (req, _res, next) => (req.user?.customerId ? next(forbidden('Staff only')) : next()), dashboard.summary);

  r.get('/leads', need('lead:view'), c.listLeads);
  r.post('/leads', need('lead:create'), c.createLead);
  r.get('/leads/:id', need('lead:view'), c.getLead);
  r.post('/leads/:id/transition', need('lead:edit'), c.transitionLead);
  r.post('/leads/:id/activities', need('lead:edit'), c.addLeadNote);
  r.post('/leads/:id/follow-ups', need('followup:manage'), c.addFollowUp);
  r.post('/leads/:id/convert', need('lead:convert'), c.convertLead);
  r.get('/follow-ups', need('lead:view'), c.listFollowUps);
  r.post('/follow-ups/:id/complete', need('followup:manage'), c.completeFollowUp);

  r.get('/customers', need('customer:view'), c.listCustomers);
  r.post('/customers', need('customer:create'), c.createCustomer);
  r.get('/customers/:id', need('customer:view'), c.getCustomer);

  r.get('/kyc-cases', need('kyc:view'), c.listKyc);
  r.get('/kyc-cases/:id', need('kyc:view'), c.getKyc);
  r.post('/kyc-cases/:id/documents', need('kyc:submit'), c.addKycDocument);
  r.post('/kyc-cases/:id/submit', need('kyc:submit'), c.submitKyc);
  r.post('/kyc-cases/:id/decision', need('kyc:decide'), c.decideKyc);

  r.get('/memberships/applications', need('application:view'), c.listApplications);
  r.post('/memberships/applications', need('application:create'), c.createApplication);
  r.post('/memberships/applications/:id/decision', need('application:approve'), c.decideApplication);

  r.get('/schemes/meta', need('scheme:view'), ch.schemeMeta);
  r.get('/schemes/published-versions', need('scheme:view'), ch.publishedVersions);
  r.get('/schemes', need('scheme:view'), ch.listSchemes);
  r.post('/schemes', need('scheme:create'), ch.createScheme);
  r.get('/schemes/:id', need('scheme:view'), ch.getScheme);
  r.post('/schemes/:id/versions', need('scheme:create'), ch.newSchemeVersion);
  r.put('/scheme-versions/:id', need('scheme:edit'), ch.updateVersion);
  r.post('/scheme-versions/:id/submit', need('scheme:submit'), ch.submitVersion);
  r.post('/scheme-versions/:id/withdraw', need('scheme:submit'), ch.withdrawVersion);
  r.post('/scheme-versions/:id/publish', need('scheme:publish'), ch.publishVersion);
  r.post('/scheme-versions/:id/retire', need('scheme:retire'), ch.retireVersion);

  r.get('/calculations/rules', need('scheme:view'), ch.calcRules);
  r.post('/calculations/preview', need('scheme:view'), ch.calcPreview);

  r.get('/groups', need('group:view'), ch.listGroups);
  r.post('/groups', need('group:create'), ch.createGroup);
  r.get('/groups/:id', need('group:view'), ch.getGroup);
  r.put('/groups/:id', need('group:edit'), ch.updateGroup);
  r.post('/groups/:id/submit', need('group:submit'), ch.submitGroup);
  r.post('/groups/:id/withdraw', need('group:submit'), ch.withdrawGroupOpen);
  r.post('/groups/:id/tickets', need('group:allocate'), ch.allocate);
  r.post('/groups/:id/tickets/:ticketNo/release', need('group:allocate'), ch.release);
  r.post('/groups/:id/checklist/:itemId/confirm', need('group:attest'), ch.attest);
  r.post('/groups/:id/open-enrolment', need('group:open-enrolment'), ch.openEnrolment);
  r.post('/groups/:id/documents', need('group:attest'), ch.addDocument);
  r.post('/groups/:id/ready', need('group:submit'), ch.markReady);
  r.post('/groups/:id/reopen', need('group:submit'), ch.reopen);
  r.post('/groups/:id/activation-request', need('group:submit'), ch.requestActivation);
  r.post('/groups/:id/activation-request/withdraw', need('group:submit'), ch.withdrawActivation);
  r.post('/groups/:id/suspend', need('group:suspend'), ch.suspend);
  r.post('/groups/:id/resume', need('group:suspend'), ch.resume);

  r.get('/approvals', need('approval:view'), ch.listApprovals);
  r.get('/approvals/:id', need('approval:view'), ch.getApproval);
  r.post('/approvals/:id/start-review', need('approval:view'), ch.startReview);
  r.post('/approvals/:id/decision', need('approval:view'), ch.decideApproval);

  r.get('/instalments', need('instalment:view'), fin.listInstalments);
  r.get('/instalments/summary', need('instalment:view'), fin.instalmentSummary);
  r.get('/instalments/arrears', need('instalment:view'), fin.arrears);

  r.get('/payments/meta', need('payment:view'), fin.paymentMeta);
  r.post('/payments/offline', need('collection:record'), fin.recordOffline);
  r.get('/payments', need('payment:view'), fin.listPayments);
  r.get('/payments/:id', need('payment:view'), fin.getPayment);
  r.post('/payments/:id/reversal-request', need('payment:reverse-request'), fin.requestPaymentReversal);
  r.get('/receipts', need('receipt:view'), fin.listReceipts);

  r.post('/payment-attempts', need('payment:initiate'), fin.initiateOnline);
  r.get('/payment-attempts', need('payment:view'), fin.listAttempts);
  r.post('/payment-attempts/:id/cancel', need('payment:initiate'), fin.cancelAttempt);
  r.post('/payment-attempts/:id/simulated-callback', need('payment:simulate'), fin.simulateCallback);

  r.get('/reconciliation/queue', need('reconcile:view'), fin.reconQueue);
  r.get('/reconciliation/bank-lines', need('reconcile:view'), fin.listBankLines);
  r.post('/reconciliation/bank-lines', need('reconcile:manage'), fin.importBankLines);
  r.post('/reconciliation/match', need('reconcile:manage'), fin.match);
  r.get('/reconciliation/results', need('reconcile:view'), fin.reconResults);

  r.get('/accounting/accounts', need('accounting:view'), fin.accounts);
  r.post('/accounting/accounts', need('account:manage'), fin.createAccount);
  r.post('/accounting/accounts/:id/active', need('account:manage'), fin.setAccountActive);
  r.get('/accounting/periods', need('accounting:view'), fin.periods);
  r.post('/accounting/periods/:id/close', need('period:manage'), fin.closePeriod);
  r.post('/accounting/periods/:id/reopen', need('period:manage'), fin.reopenPeriod);
  r.get('/accounting/posting-rules', need('accounting:view'), fin.postingRules);
  r.get('/accounting/journals', need('accounting:view'), fin.listJournals);
  r.post('/accounting/journals', need('journal:create'), fin.createJournal);
  r.get('/accounting/journals/:id', need('accounting:view'), fin.getJournal);
  r.put('/accounting/journals/:id', need('journal:create'), fin.updateJournal);
  r.post('/accounting/journals/:id/submit', need('journal:submit'), fin.submitJournal);
  r.post('/accounting/journals/:id/withdraw', need('journal:submit'), fin.withdrawJournal);
  r.post('/accounting/journals/:id/reversal-request', need('journal:submit'), fin.requestJournalReversal);
  r.get('/accounting/ledger', need('accounting:view'), fin.ledger);
  r.get('/accounting/trial-balance', need('accounting:view'), fin.trialBalance);
  r.get('/accounting/statements', need('accounting:view'), fin.statements);

  r.get('/auctions/meta', need('auction:view'), au.auctionMeta);
  r.get('/auctions', need('auction:view'), au.listAuctions);
  r.post('/auctions', need('auction:create'), au.createAuction);
  r.get('/auctions/:id', need('auction:view'), au.getAuction);
  r.post('/auctions/:id/reschedule', need('auction:create'), au.reschedule);
  r.post('/auctions/:id/ready', need('auction:prepare'), au.markReady);
  r.post('/auctions/:id/cancel', need('auction:operate'), au.cancelAuction);
  r.post('/auctions/:id/close', need('auction:operate'), au.closeEarly);
  r.post('/auctions/:id/bids', need('bid:submit'), au.submitBid);
  r.post('/auctions/:id/compute', need('auction:operate'), au.compute);
  r.post('/auctions/:id/tie-decision', need('auction:operate'), au.decideTie);
  r.post('/auctions/:id/validate', need('auction:operate'), au.validate);
  r.post('/auctions/:id/submit', need('auction:operate'), au.submitResult);
  r.post('/auctions/:id/withdraw', need('auction:operate'), au.withdrawResult);
  r.post('/auctions/:id/disputes', need('dispute:raise'), au.raiseDispute);
  r.post('/auctions/:id/disputes/:disputeId/resolve', need('dispute:resolve'), au.resolveDispute);

  r.get('/payouts/meta', need('payout:view'), au.payoutMeta);
  r.get('/payouts/reconciliation', need('payout:view'), au.payoutQueue);
  r.post('/payouts/reconciliation/match', need('payout:reconcile'), au.payoutMatch);
  r.get('/payouts', need('payout:view'), au.listPayouts);
  r.post('/payouts', need('payout:create'), au.createPayout);
  r.get('/payouts/:id', need('payout:view'), au.getPayout);
  r.put('/payouts/:id', need('payout:create'), au.updatePayout);
  r.post('/payouts/:id/submit-review', need('payout:create'), au.submitReview);
  r.post('/payouts/:id/send-back', need('payout:review'), au.sendBack);
  r.post('/payouts/:id/documents/:docId/confirm', need('payout:review'), au.confirmDocument);
  r.post('/payouts/:id/request-approval', need('payout:review'), au.requestPayoutApproval);
  r.post('/payouts/:id/withdraw', need('payout:review'), au.withdrawPayout);
  r.post('/payouts/:id/initiate', need('payout:disburse'), au.initiate);
  r.post('/payouts/:id/disbursement', need('payout:disburse'), au.recordDisbursement);
  r.post('/payouts/:id/failure', need('payout:disburse'), au.recordFailure);
  r.post('/payouts/:id/hold', need('payout:hold'), au.hold);
  r.post('/payouts/:id/release', need('payout:hold'), au.release);

  // Customer portal: a stable, member-scoped API that a future mobile app can reuse unchanged.
  // The customer is always taken from the session, never from the request.
  const member = (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) =>
    (req.user?.customerId ? next() : next(forbidden('This area is for members only', 'MEMBER_ONLY')));
  r.use('/portal', need('portal:access'), member);
  r.get('/portal/profile', po.profile);
  r.get('/portal/summary', po.summary);
  r.get('/portal/instalments', po.instalments);
  r.get('/portal/payments', po.payments);
  r.get('/portal/payments/:id', po.payment);
  r.get('/portal/statement', po.statement);
  r.get('/portal/payment-attempts', po.attempts);
  r.post('/portal/payment-attempts', po.initiate);
  r.post('/portal/payment-attempts/:id/cancel', po.cancelAttempt);
  r.get('/portal/payouts', po.payouts);
  r.get('/portal/support/meta', po.supportMeta);
  r.get('/portal/support-cases', po.myCases);
  r.post('/portal/support-cases', po.createCase);
  r.get('/portal/support-cases/:id', po.myCase);
  r.post('/portal/support-cases/:id/messages', po.memberReply);

  r.get('/support-cases', need('support:view'), po.staffCases);
  r.get('/support-cases/:id', need('support:view'), po.staffCase);
  r.post('/support-cases/:id/messages', need('support:manage'), po.staffReply);
  r.post('/support-cases/:id/assign', need('support:manage'), po.assign);
  r.post('/support-cases/:id/status', need('support:manage'), po.setStatus);

  if (deps.userAdmin) {
    const ua = deps.userAdmin;
    const ctxOf = (req: import('express').Request) => ({ uow: req.uow!, ip: req.ip, userAgent: req.header('user-agent') });
    r.get('/users', need('user:view'), async (_req, res) => void res.json(await ua.list()));
    r.post('/users', need('user:manage'), async (req, res) => void res.status(201).json(await ua.createStaff(ctxOf(req), req.user!, req.body ?? {})));
    r.post('/users/member-accounts', need('user:manage'), async (req, res) => void res.status(201).json(await ua.createMemberAccount(ctxOf(req), req.user!, req.body ?? {})));
    r.put('/users/:id/access', need('user:manage'), (req, res) => void res.json(ua.updateAccess(ctxOf(req), req.user!, String(req.params.id), req.body ?? {})));
    r.post('/users/:id/disable', need('user:manage'), (req, res) => void res.json(ua.setDisabled(ctxOf(req), req.user!, String(req.params.id), true)));
    r.post('/users/:id/enable', need('user:manage'), (req, res) => void res.json(ua.setDisabled(ctxOf(req), req.user!, String(req.params.id), false)));
    r.post('/users/:id/activation-code', need('user:manage'), async (req, res) => void res.status(201).json(await ua.issueActivation(ctxOf(req), req.user!, String(req.params.id))));
    r.post('/users/:id/reset-mfa', need('user:manage'), (req, res) => void res.json(ua.resetMfa(ctxOf(req), req.user!, String(req.params.id))));
  }

  r.get('/audit-logs', need('audit:view'), c.auditLogs);
  return r;
};

