import { apiRequest } from '../../services/apiClient.js';

export const fetchDashboardSummary = (signal) => apiRequest('/dashboard/summary', { signal });
