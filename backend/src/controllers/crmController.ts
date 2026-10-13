import type { Request, RequestHandler } from 'express';
import { permissionsOf } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import type { createApplicationService } from '../services/applicationService.js';
import type { createCrmService } from '../services/crmService.js';
import type { createKycService } from '../services/kycService.js';

const body = (r: Request) => (r.body ?? {}) as Record<string, unknown>;
const query = (r: Request) => r.query as Record<string, unknown>;
const id = (r: Request) => String(r.params.id);

export const createCrmController = (
  store: Store,
  crm: ReturnType<typeof createCrmService>,
  kyc: ReturnType<typeof createKycService>,
  apps: ReturnType<typeof createApplicationService>,
) => {
  const h = (fn: RequestHandler): RequestHandler => fn;
  return {
    me: h((req, res) => {
      const u = req.user!;
      res.json({ user: { id: u.id, name: u.name, roles: u.roles, branchIds: u.branchIds, customerId: u.customerId }, permissions: permissionsOf(u) });
    }),
    devUsers: h((_req, res) => {
      res.json({
        simulated: true,
        notice: 'Simulated sign-in for development. A real authentication provider has not been selected.',
        users: store.users.map(({ id: uid, name, roles, branchIds, customerId }) => ({ id: uid, name, roles, branchIds, customerId })),
      });
    }),
    meta: h((_req, res) => res.json(crm.meta())),

    listLeads: h((req, res) => res.json(crm.listLeads(req.user!, query(req)))),
    getLead: h((req, res) => res.json(crm.getLeadDetail(req.user!, id(req)))),
    createLead: h((req, res) => res.status(201).json(crm.createLead(req.user!, body(req)))),
    transitionLead: h((req, res) => res.json(crm.transitionLead(req.user!, id(req), body(req)))),
    addLeadNote: h((req, res) => res.status(201).json(crm.addLeadNote(req.user!, id(req), body(req)))),
    addFollowUp: h((req, res) => res.status(201).json(crm.addFollowUp(req.user!, id(req), body(req)))),
    convertLead: h((req, res) => res.status(201).json(crm.convertLead(req.user!, id(req), body(req)))),
    listFollowUps: h((req, res) => res.json(crm.listFollowUps(req.user!, query(req)))),
    completeFollowUp: h((req, res) => res.json(crm.completeFollowUp(req.user!, id(req)))),

    listCustomers: h((req, res) => res.json(crm.listCustomers(req.user!, query(req)))),
    createCustomer: h((req, res) => res.status(201).json(crm.createCustomer(req.user!, body(req)))),
    getCustomer: h((req, res) => res.json(crm.getCustomerProfile(req.user!, id(req)))),

    listKyc: h((req, res) => res.json(kyc.list(req.user!, query(req)))),
    getKyc: h((req, res) => res.json(kyc.get(req.user!, id(req)))),
    addKycDocument: h((req, res) => res.status(201).json(kyc.addDocument(req.user!, id(req), body(req)))),
    submitKyc: h((req, res) => res.json(kyc.submit(req.user!, id(req)))),
    decideKyc: h((req, res) => res.json(kyc.decide(req.user!, id(req), body(req)))),

    listApplications: h((req, res) => res.json(apps.list(req.user!, query(req)))),
    createApplication: h((req, res) => res.status(201).json(apps.create(req.user!, body(req)))),
    decideApplication: h((req, res) => res.json(apps.decide(req.user!, id(req), body(req)))),

    auditLogs: h((req, res) => {
      const rows = [...store.audit].reverse().map((a) => ({
        ...a, actorName: store.users.find((u) => u.id === a.actorId)?.name ?? a.actorId,
      }));
      const page = Math.max(Number(req.query.page) || 1, 1);
      const pageSize = Math.min(Number(req.query.pageSize) || 20, 100);
      res.json({ items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: rows.length });
    }),
  };
};
