import type { RequestHandler } from 'express';
import type { createDashboardService } from '../services/dashboardService.js';

export const createDashboardController = (service: ReturnType<typeof createDashboardService>) => ({
  summary: (async (_req, res, next) => {
    try {
      res.json(await service.getSummary());
    } catch (e) {
      next(e);
    }
  }) as RequestHandler,
});
