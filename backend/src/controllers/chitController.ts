import type { Request, RequestHandler } from 'express';
import type { ApprovalService } from '../services/approvalService.js';
import type { CalculationService } from '../services/calculationService.js';
import type { GroupService } from '../services/groupService.js';
import type { SchemeService } from '../services/schemeService.js';

const body = (r: Request) => (r.body ?? {}) as Record<string, unknown>;
const query = (r: Request) => r.query as Record<string, unknown>;
const id = (r: Request) => String(r.params.id);
const h = (fn: RequestHandler): RequestHandler => fn;

export const createChitController = (schemes: SchemeService, groups: GroupService, approvals: ApprovalService, calc: CalculationService) => ({
  schemeMeta: h((_req, res) => res.json(schemes.meta())),
  listSchemes: h((req, res) => res.json(schemes.list(req.user!, query(req)))),
  getScheme: h((req, res) => res.json(schemes.get(req.user!, id(req)))),
  createScheme: h((req, res) => res.status(201).json(schemes.create(req.user!, body(req)))),
  newSchemeVersion: h((req, res) => res.status(201).json(schemes.createVersion(req.user!, id(req)))),
  updateVersion: h((req, res) => res.json(schemes.updateDraft(req.user!, id(req), body(req)))),
  submitVersion: h((req, res) => res.json(schemes.submit(req.user!, id(req)))),
  withdrawVersion: h((req, res) => res.json(schemes.withdraw(req.user!, id(req)))),
  publishVersion: h((req, res) => res.json(schemes.publish(req.user!, id(req)))),
  retireVersion: h((req, res) => res.json(schemes.retire(req.user!, id(req), body(req)))),
  publishedVersions: h((_req, res) => res.json({ items: schemes.publishedVersions() })),

  listGroups: h((req, res) => res.json(groups.list(req.user!, query(req)))),
  getGroup: h((req, res) => res.json(groups.get(req.user!, id(req)))),
  createGroup: h((req, res) => res.status(201).json(groups.create(req.user!, body(req)))),
  updateGroup: h((req, res) => res.json(groups.update(req.user!, id(req), body(req)))),
  submitGroup: h((req, res) => res.json(groups.submit(req.user!, id(req)))),
  withdrawGroupOpen: h((req, res) => res.json(groups.withdrawOpen(req.user!, id(req)))),
  allocate: h((req, res) => res.json(groups.allocate(req.user!, id(req), body(req)))),
  release: h((req, res) => res.json(groups.release(req.user!, id(req), Number(req.params.ticketNo), body(req)))),
  attest: h((req, res) => res.json(groups.attest(req.user!, id(req), String(req.params.itemId), body(req)))),
  openEnrolment: h((req, res) => res.json(groups.openEnrolment(req.user!, id(req)))),
  addDocument: h((req, res) => res.status(201).json(groups.addDocument(req.user!, id(req), body(req)))),
  calcRules: h((_req, res) => res.json(calc.rules())),
  calcPreview: h((req, res) => res.json(calc.preview(body(req)))),
  markReady: h((req, res) => res.json(groups.markReady(req.user!, id(req)))),
  reopen: h((req, res) => res.json(groups.reopen(req.user!, id(req)))),
  requestActivation: h((req, res) => res.json(groups.requestActivation(req.user!, id(req)))),
  withdrawActivation: h((req, res) => res.json(groups.withdrawActivation(req.user!, id(req)))),
  suspend: h((req, res) => res.json(groups.setSuspended(req.user!, id(req), true, body(req)))),
  resume: h((req, res) => res.json(groups.setSuspended(req.user!, id(req), false, body(req)))),

  listApprovals: h((req, res) => res.json(approvals.list(req.user!, query(req)))),
  getApproval: h((req, res) => res.json(approvals.get(req.user!, id(req)))),
  startReview: h((req, res) => res.json(approvals.startReview(req.user!, id(req)))),
  decideApproval: h((req, res) => res.json(approvals.decide(req.user!, id(req), body(req)))),
});
