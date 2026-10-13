import type { DashboardRepository } from '../repositories/dashboardRepository.js';

export const createDashboardService = (repo: DashboardRepository) => ({
  async getSummary() {
    const data = await repo.getSummary();
    return {
      dataSource: repo.source,
      notice: repo.source === 'demo' ? 'Sample data for demonstration. Not live financial information.' : undefined,
      data,
    };
  },
});
