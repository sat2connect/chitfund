import type { Request, RequestHandler } from 'express';
import type { AccountingService } from '../services/accountingService.js';
import type { CollectionService } from '../services/collectionService.js';
import type { InstalmentService } from '../services/instalmentService.js';

const body = (r: Request) => (r.body ?? {}) as Record<string, unknown>;
const query = (r: Request) => r.query as Record<string, unknown>;
const id = (r: Request) => String(r.params.id);
const h = (fn: RequestHandler): RequestHandler => fn;

export const createFinanceController = (inst: InstalmentService, col: CollectionService, acc: AccountingService) => ({
  listInstalments: h((req, res) => res.json(inst.list(req.user!, query(req)))),
  instalmentSummary: h((req, res) => res.json(inst.summary(req.user!, query(req)))),
  arrears: h((req, res) => res.json(inst.arrears(req.user!, query(req)))),

  paymentMeta: h((_req, res) => res.json(col.meta())),
  recordOffline: h((req, res) => {
    const r = col.recordOffline(req.user!, body(req));
    res.status(r.duplicate ? 200 : 201).json(r);
  }),
  listPayments: h((req, res) => res.json(col.listPayments(req.user!, query(req)))),
  getPayment: h((req, res) => res.json(col.getPayment(req.user!, id(req)))),
  requestPaymentReversal: h((req, res) => res.status(201).json(col.requestReversal(req.user!, id(req), body(req)))),
  listReceipts: h((req, res) => res.json(col.listReceipts(req.user!, query(req)))),

  initiateOnline: h((req, res) => res.status(201).json(col.initiateOnline(req.user!, body(req)))),
  listAttempts: h((req, res) => res.json(col.listAttempts(req.user!, query(req)))),
  cancelAttempt: h((req, res) => res.json(col.cancelAttempt(req.user!, id(req)))),
  simulateCallback: h((req, res) => res.json(col.simulateCallback(req.user!, id(req), body(req)))),

  reconQueue: h((req, res) => res.json(col.reconciliationQueue(req.user!, query(req)))),
  listBankLines: h((req, res) => res.json(col.listBankLines(req.user!, query(req)))),
  importBankLines: h((req, res) => res.status(201).json(col.importBankLines(req.user!, body(req)))),
  match: h((req, res) => res.status(201).json(col.match(req.user!, body(req)))),
  reconResults: h((req, res) => res.json(col.listResults(req.user!))),

  accounts: h((_req, res) => res.json(acc.listAccounts())),
  createAccount: h((req, res) => res.status(201).json(acc.createAccount(req.user!, body(req)))),
  setAccountActive: h((req, res) => res.json(acc.setAccountActive(req.user!, id(req), body(req).active === true))),
  periods: h((_req, res) => res.json(acc.listPeriods())),
  closePeriod: h((req, res) => res.json(acc.closePeriod(req.user!, id(req)))),
  reopenPeriod: h((req, res) => res.json(acc.reopenPeriod(req.user!, id(req), body(req)))),
  postingRules: h((_req, res) => res.json(acc.postingRules())),
  listJournals: h((req, res) => res.json(acc.listJournals(req.user!, query(req)))),
  getJournal: h((req, res) => res.json(acc.getJournal(req.user!, id(req)))),
  createJournal: h((req, res) => res.status(201).json(acc.createDraft(req.user!, body(req)))),
  updateJournal: h((req, res) => res.json(acc.updateDraft(req.user!, id(req), body(req)))),
  submitJournal: h((req, res) => res.json(acc.submit(req.user!, id(req)))),
  withdrawJournal: h((req, res) => res.json(acc.withdraw(req.user!, id(req)))),
  requestJournalReversal: h((req, res) => res.status(201).json(acc.requestReversal(req.user!, id(req), body(req)))),
  ledger: h((req, res) => res.json(acc.ledger(req.user!, query(req)))),
  trialBalance: h((req, res) => res.json(acc.trialBalance(req.user!, query(req)))),
  statements: h((req, res) => res.json(acc.statements(req.user!, query(req)))),
});
