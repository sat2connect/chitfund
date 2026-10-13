import type { Request, RequestHandler } from 'express';
import type { AuctionService } from '../services/auctionService.js';
import type { PayoutService } from '../services/payoutService.js';

const body = (r: Request) => (r.body ?? {}) as Record<string, unknown>;
const query = (r: Request) => r.query as Record<string, unknown>;
const id = (r: Request) => String(r.params.id);
const h = (fn: RequestHandler): RequestHandler => fn;

export const createAuctionController = (a: AuctionService, p: PayoutService) => ({
  auctionMeta: h((_req, res) => res.json(a.meta())),
  listAuctions: h((req, res) => res.json(a.list(req.user!, query(req)))),
  getAuction: h((req, res) => res.json(a.getForUser(req.user!, id(req)))),
  createAuction: h((req, res) => res.status(201).json(a.create(req.user!, body(req)))),
  reschedule: h((req, res) => res.json(a.reschedule(req.user!, id(req), body(req)))),
  markReady: h((req, res) => res.json(a.markReady(req.user!, id(req)))),
  cancelAuction: h((req, res) => res.json(a.cancel(req.user!, id(req), body(req)))),
  closeEarly: h((req, res) => res.json(a.closeEarly(req.user!, id(req), body(req)))),
  submitBid: h((req, res) => {
    const r = a.submitBid(req.user!, id(req), body(req));
    res.status(r.duplicate ? 200 : 201).json(r);
  }),
  compute: h((req, res) => res.json(a.computeResult(req.user!, id(req)))),
  decideTie: h((req, res) => res.json(a.decideTie(req.user!, id(req), body(req)))),
  validate: h((req, res) => res.json(a.validate(req.user!, id(req)))),
  submitResult: h((req, res) => res.json(a.submitForApproval(req.user!, id(req)))),
  withdrawResult: h((req, res) => res.json(a.withdraw(req.user!, id(req)))),
  raiseDispute: h((req, res) => res.status(201).json(a.raiseDispute(req.user!, id(req), body(req)))),
  resolveDispute: h((req, res) => res.json(a.resolveDispute(req.user!, id(req), String(req.params.disputeId), body(req)))),

  payoutMeta: h((_req, res) => res.json(p.meta())),
  listPayouts: h((req, res) => res.json(p.list(req.user!, query(req)))),
  getPayout: h((req, res) => res.json(p.getForUser(req.user!, id(req)))),
  createPayout: h((req, res) => {
    const r = p.create(req.user!, body(req));
    res.status(r.duplicate ? 200 : 201).json(r);
  }),
  updatePayout: h((req, res) => res.json(p.update(req.user!, id(req), body(req)))),
  submitReview: h((req, res) => res.json(p.submitForReview(req.user!, id(req)))),
  sendBack: h((req, res) => res.json(p.sendBack(req.user!, id(req), body(req)))),
  confirmDocument: h((req, res) => res.json(p.confirmDocument(req.user!, id(req), String(req.params.docId), body(req)))),
  requestPayoutApproval: h((req, res) => res.json(p.requestApproval(req.user!, id(req)))),
  withdrawPayout: h((req, res) => res.json(p.withdraw(req.user!, id(req)))),
  initiate: h((req, res) => res.json(p.initiateDisbursement(req.user!, id(req), body(req)))),
  recordDisbursement: h((req, res) => res.json(p.recordDisbursement(req.user!, id(req), body(req)))),
  recordFailure: h((req, res) => res.json(p.recordFailure(req.user!, id(req), body(req)))),
  hold: h((req, res) => res.json(p.hold(req.user!, id(req), body(req)))),
  release: h((req, res) => res.json(p.release(req.user!, id(req), body(req)))),
  payoutQueue: h((req, res) => res.json(p.reconciliationQueue(req.user!, query(req)))),
  payoutMatch: h((req, res) => res.status(201).json(p.match(req.user!, body(req)))),
});
