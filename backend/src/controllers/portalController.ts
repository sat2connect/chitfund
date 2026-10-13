import type { Request, RequestHandler } from 'express';
import type { PortalService } from '../services/portalService.js';
import type { SupportService } from '../services/supportService.js';

const body = (r: Request) => (r.body ?? {}) as Record<string, unknown>;
const query = (r: Request) => r.query as Record<string, unknown>;
const id = (r: Request) => String(r.params.id);
const h = (fn: RequestHandler): RequestHandler => fn;

export const createPortalController = (p: PortalService, sup: SupportService) => ({
  profile: h((req, res) => res.json(p.profile(req.user!))),
  summary: h((req, res) => res.json(p.summary(req.user!))),
  instalments: h((req, res) => res.json(p.instalments(req.user!, query(req)))),
  payments: h((req, res) => res.json(p.payments(req.user!, query(req)))),
  payment: h((req, res) => res.json(p.payment(req.user!, id(req)))),
  statement: h((req, res) => res.json(p.statement(req.user!, query(req)))),
  attempts: h((req, res) => res.json(p.attempts(req.user!))),
  initiate: h((req, res) => res.status(201).json(p.initiate(req.user!, body(req)))),
  cancelAttempt: h((req, res) => res.json(p.cancelAttempt(req.user!, id(req)))),
  payouts: h((req, res) => res.json(p.payouts(req.user!))),

  supportMeta: h((_req, res) => res.json(sup.meta())),
  myCases: h((req, res) => res.json(sup.listMine(req.user!, query(req)))),
  myCase: h((req, res) => res.json(sup.getMine(req.user!, id(req)))),
  createCase: h((req, res) => {
    const r = sup.create(req.user!, body(req));
    res.status(r.duplicate ? 200 : 201).json(r);
  }),
  memberReply: h((req, res) => res.status(201).json(sup.memberReply(req.user!, id(req), body(req)))),

  staffCases: h((req, res) => res.json(sup.list(req.user!, query(req)))),
  staffCase: h((req, res) => res.json(sup.get(req.user!, id(req)))),
  staffReply: h((req, res) => res.status(201).json(sup.staffReply(req.user!, id(req), body(req)))),
  assign: h((req, res) => res.json(sup.assignToMe(req.user!, id(req)))),
  setStatus: h((req, res) => res.json(sup.setStatus(req.user!, id(req), body(req)))),
});
