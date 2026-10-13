import { apiRequest, toQuery } from '../../services/apiClient.js';

const post = (path, body) => apiRequest(path, { method: 'POST', body });

// Member-scoped API: the server derives the customer from the session; ids are never sent for identity.
export const getProfile = (signal) => apiRequest('/portal/profile', { signal });
export const getSummary = (signal) => apiRequest('/portal/summary', { signal });
export const listMyInstalments = (p, signal) => apiRequest(`/portal/instalments${toQuery(p)}`, { signal });
export const listMyPayments = (p, signal) => apiRequest(`/portal/payments${toQuery(p)}`, { signal });
export const getMyPayment = (id, signal) => apiRequest(`/portal/payments/${id}`, { signal });
export const getStatement = (p, signal) => apiRequest(`/portal/statement${toQuery(p)}`, { signal });
export const listMyAttempts = (signal) => apiRequest('/portal/payment-attempts', { signal });
export const startPayment = (body) => post('/portal/payment-attempts', body);
export const cancelMyAttempt = (id) => post(`/portal/payment-attempts/${id}/cancel`);
export const listMyPayouts = (signal) => apiRequest('/portal/payouts', { signal });

export const getSupportMeta = (signal) => apiRequest('/portal/support/meta', { signal });
export const listMyCases = (p, signal) => apiRequest(`/portal/support-cases${toQuery(p)}`, { signal });
export const getMyCase = (id, signal) => apiRequest(`/portal/support-cases/${id}`, { signal });
export const createCase = (body) => post('/portal/support-cases', body);
export const replyToCase = (id, body) => post(`/portal/support-cases/${id}/messages`, body);

// Staff side
export const listCases = (p, signal) => apiRequest(`/support-cases${toQuery(p)}`, { signal });
export const getCase = (id, signal) => apiRequest(`/support-cases/${id}`, { signal });
export const staffReply = (id, body) => post(`/support-cases/${id}/messages`, body);
export const assignCase = (id) => post(`/support-cases/${id}/assign`);
export const setCaseStatus = (id, body) => post(`/support-cases/${id}/status`, body);