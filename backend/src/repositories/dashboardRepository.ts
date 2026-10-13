import { dashboardDemo } from '../seed/dashboardDemo.js';

export type DashboardData = typeof dashboardDemo;

export interface DashboardRepository {
  readonly source: 'demo' | 'live';
  getSummary(): Promise<DashboardData>;
}

// In-memory/demo implementation: development only, not production persistence.
export const demoDashboardRepository: DashboardRepository = {
  source: 'demo',
  getSummary: async () => dashboardDemo,
};
